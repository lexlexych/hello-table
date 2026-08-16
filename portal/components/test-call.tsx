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

async function requestGrant(): Promise<Grant> {
  const response = await fetch("/api/test-call/token", { method: "POST" });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Сессия истекла. Войдите заново."
        : `Портал не выдал токен (HTTP ${response.status}).`,
    );
  }
  return (await response.json()) as Grant;
}

function describeConnectError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Браузер не дал доступ к микрофону. Разрешите его и попробуйте снова.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "Микрофон не найден.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось начать звонок.";
}

export default function TestCall() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);

  const roomRef = useRef<Room | undefined>(undefined);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const identityRef = useRef<string>("");
  const seqRef = useRef(0);

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
    setPhase("idle");
    setNotice(undefined);
    if (room) {
      await room.disconnect();
    }
  }, []);

  const startCall = useCallback(async () => {
    setError(undefined);
    setNotice(undefined);
    setTurns([]);
    setPhase("connecting");

    let room: Room | undefined;
    try {
      const grant = await requestGrant();
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
        roomRef.current = undefined;
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

      setTimeout(() => {
        const current = roomRef.current;
        if (
          current &&
          current.state === ConnectionState.Connected &&
          current.remoteParticipants.size === 0
        ) {
          setNotice(
            "Агент не вошёл в комнату. Проверьте, что запущен воркер: pnpm agent:dev",
          );
        }
      }, AGENT_JOIN_TIMEOUT_MS);
    } catch (cause) {
      await room?.disconnect();
      roomRef.current = undefined;
      setPhase("idle");
      setError(describeConnectError(cause));
    }
  }, [readTranscription]);

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect();
      roomRef.current = undefined;
    };
  }, []);

  return (
    <section>
      <p className="note">
        Разговор идёт по-немецки: агент пока одноязычный. Инструменты не
        подключены — забронировать столик он не может и честно об этом скажет.
      </p>

      <div className="call-controls">
        {phase === "live" ? (
          <button type="button" onClick={() => void stopCall()}>
            Завершить
          </button>
        ) : (
          <button
            className="primary"
            type="button"
            onClick={() => void startCall()}
            disabled={phase === "connecting"}
          >
            {phase === "connecting" ? "Соединяю…" : "Позвонить"}
          </button>
        )}
        <span className="call-status">
          {phase === "live"
            ? "Идёт разговор — говорите в микрофон"
            : phase === "connecting"
              ? "Подключаюсь к комнате"
              : "Звонок не начат"}
        </span>
      </div>

      {error ? <p className="call-error">{error}</p> : null}
      {notice ? <p className="call-error">{notice}</p> : null}

      <div className="transcript">
        {turns.length === 0 ? (
          <p className="transcript-empty">
            Транскрипт появится здесь. Он нигде не сохраняется и исчезнет при
            перезагрузке страницы.
          </p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.segmentId}
              className={`turn ${turn.speaker} ${turn.final ? "" : "interim"}`}
            >
              <span className="turn-speaker">
                {turn.speaker === "agent" ? "Агент" : "Вы"}
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
