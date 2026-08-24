"use client";

import {
  ConnectionState,
  type RemoteTrack,
  Room,
  RoomEvent,
  type TextStreamReader,
  Track,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/catalog";

/**
 * Тестовый звонок из браузера (PROJECT.md §7.3 п.10, сценарий F из §1.2).
 *
 * Портал не реализует цепочку STT → LLM → TTS: он подключает микрофон к комнате LiveKit,
 * куда воркер агента входит сам. Всё распознавание, ответ модели и синтез речи происходят
 * в `agent/`.
 *
 * Транскрипт живёт только в состоянии этого компонента: ни на сервер, ни в localStorage он
 * не уходит и после перезагрузки страницы исчезает (PROJECT.md §7.3, §11.3).
 */

const TRANSCRIPTION_TOPIC = "lk.transcription";
const ATTRIBUTE_SEGMENT_ID = "lk.segment_id";
const ATTRIBUTE_FINAL = "lk.transcription_final";

/** Сколько ждём воркер агента, прежде чем сказать, что он не пришёл. */
const AGENT_JOIN_TIMEOUT_MS = 12_000;

function formatCallDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds];

  if (hours > 0) {
    parts.unshift(hours);
  }

  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

type Phase = "idle" | "connecting" | "live";

interface Turn {
  segmentId: string;
  speaker: "user" | "agent";
  text: string;
  final: boolean;
  /** Порядковый номер полученного стрима: защищает от применения устаревшего обновления. */
  seq: number;
}

interface Grant {
  url: string;
  token: string;
  room: string;
  identity: string;
}

type Translate = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

async function requestGrant(t: Translate): Promise<Grant> {
  const response = await fetch("/api/test-call/token", { method: "POST" });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? t("common.sessionExpired")
        : t("testCall.tokenFailed", { status: response.status }),
    );
  }
  return (await response.json()) as Grant;
}

function describeConnectError(error: unknown, t: Translate): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return t("testCall.micDenied");
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return t("testCall.micMissing");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return t("testCall.startFailed");
}

export default function TestCall() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);

  const roomRef = useRef<Room | undefined>(undefined);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const identityRef = useRef<string>("");
  const seqRef = useRef(0);
  const callStartedAtRef = useRef<number | undefined>(undefined);
  const timerRef = useRef<number | undefined>(undefined);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }

    const startedAt = callStartedAtRef.current;
    if (startedAt !== undefined) {
      setCallDurationSeconds(Math.floor((Date.now() - startedAt) / 1_000));
      callStartedAtRef.current = undefined;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    const startedAt = Date.now();
    callStartedAtRef.current = startedAt;
    setCallDurationSeconds(0);
    timerRef.current = window.setInterval(() => {
      setCallDurationSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
  }, [stopTimer]);

  const upsertTurn = useCallback((update: Turn) => {
    setTurns((current) => {
      const index = current.findIndex(
        (turn) => turn.segmentId === update.segmentId,
      );
      if (index === -1) {
        return [...current, update];
      }
      const existing = current[index];
      if (existing && existing.seq > update.seq) {
        return current;
      }
      const next = [...current];
      next[index] = update;
      return next;
    });
  }, []);

  const readTranscription = useCallback(
    async (reader: TextStreamReader, senderIdentity: string) => {
      const attributes = reader.info.attributes ?? {};
      const segmentId = attributes[ATTRIBUTE_SEGMENT_ID] ?? reader.info.id;
      // Агент публикует реплики гостя от его имени, поэтому говорящий определяется по identity.
      const speaker = senderIdentity === identityRef.current ? "user" : "agent";
      const seq = ++seqRef.current;

      let text = "";
      for await (const chunk of reader) {
        // Реплики агента идут дельта-стримом (один стрим на сегмент, чанки — приращения),
        // реплики гостя — целиком в каждом обновлении. Накопление внутри одного стрима
        // даёт верный текст в обоих случаях.
        text += chunk;
        upsertTurn({ segmentId, speaker, text, final: false, seq });
      }

      // У дельта-стрима агента флага финальности в заголовке нет — сегмент закрыт тем, что
      // стрим закончился. У гостя финальное обновление помечено атрибутом.
      const final =
        speaker === "agent" || attributes[ATTRIBUTE_FINAL] === "true";
      upsertTurn({ segmentId, speaker, text, final, seq });
    },
    [upsertTurn],
  );

  const stopCall = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = undefined;
    stopTimer();
    setPhase("idle");
    setNotice(undefined);
    if (room) {
      await room.disconnect();
    }
  }, [stopTimer]);

  const startCall = useCallback(async () => {
    setError(undefined);
    setNotice(undefined);
    setTurns([]);
    stopTimer();
    setCallDurationSeconds(0);
    setPhase("connecting");

    let room: Room | undefined;
    try {
      const grant = await requestGrant(t);
      identityRef.current = grant.identity;

      room = new Room({
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }
        const element = track.attach();
        element.autoplay = true;
        audioHostRef.current?.appendChild(element);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        for (const element of track.detach()) {
          element.remove();
        }
      });

      room.on(RoomEvent.ParticipantConnected, () => setNotice(undefined));

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) {
          return;
        }
        roomRef.current = undefined;
        stopTimer();
        setPhase("idle");
      });

      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, info) => {
        void readTranscription(reader, info.identity);
      });

      await room.connect(grant.url, grant.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      // Звук включается внутри обработчика клика — иначе браузер заблокирует автовоспроизведение.
      await room.startAudio();

      roomRef.current = room;
      setPhase("live");
      startTimer();

      setTimeout(() => {
        const current = roomRef.current;
        if (
          current &&
          current.state === ConnectionState.Connected &&
          current.remoteParticipants.size === 0
        ) {
          setNotice(t("testCall.agentMissing"));
        }
      }, AGENT_JOIN_TIMEOUT_MS);
    } catch (cause) {
      await room?.disconnect();
      roomRef.current = undefined;
      stopTimer();
      setPhase("idle");
      setError(describeConnectError(cause, t));
    }
  }, [readTranscription, startTimer, stopTimer, t]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearInterval(timerRef.current);
      }
      void roomRef.current?.disconnect();
      roomRef.current = undefined;
    };
  }, []);

  return (
    <section>
      <div className="call-controls">
        {phase === "live" ? (
          <button type="button" onClick={() => void stopCall()}>
            {t("testCall.end")}
          </button>
        ) : (
          <button
            className="primary"
            type="button"
            onClick={() => void startCall()}
            disabled={phase === "connecting"}
          >
            {phase === "connecting"
              ? t("testCall.connecting")
              : t("testCall.call")}
          </button>
        )}
        <time className="call-timer" dateTime={`PT${callDurationSeconds}S`}>
          {formatCallDuration(callDurationSeconds)}
        </time>
        <span className="call-status">
          {phase === "live"
            ? t("testCall.live")
            : phase === "connecting"
              ? t("testCall.joining")
              : t("testCall.idle")}
        </span>
      </div>

      {error ? <p className="call-error">{error}</p> : null}
      {notice ? <p className="call-error">{notice}</p> : null}

      <div className="transcript">
        {turns.length === 0 ? (
          <p className="transcript-empty">{t("testCall.transcriptEmpty")}</p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.segmentId}
              className={`turn ${turn.speaker} ${turn.final ? "" : "interim"}`}
            >
              <span className="turn-speaker">
                {turn.speaker === "agent"
                  ? t("testCall.agent")
                  : t("testCall.you")}
              </span>
              <p className="turn-text">{turn.text}</p>
            </div>
          ))
        )}
      </div>

      <div ref={audioHostRef} hidden />
    </section>
  );
}
