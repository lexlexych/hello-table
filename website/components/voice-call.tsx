"use client";

import {
  ConnectionState,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type Participant,
  type RemoteTrack,
  Room,
  RoomEvent,
  type TextStreamReader,
  Track,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/menu";

/**
 * Звонок агенту с публичного сайта.
 *
 * Логика соединения — та же, что у тестового звонка портала
 * (portal/components/test-call.tsx): сайт не реализует цепочку STT → LLM → TTS, он лишь
 * подключает микрофон гостя к новой комнате LiveKit, куда воркер агента входит сам.
 *
 * Транскрипт живёт только в состоянии этого компонента: ни на сервер, ни в localStorage он
 * не уходит и исчезает при закрытии окна (PROJECT.md §11.3).
 */

const TRANSCRIPTION_TOPIC = "lk.transcription";
const ATTRIBUTE_SEGMENT_ID = "lk.segment_id";
const ATTRIBUTE_FINAL = "lk.transcription_final";

/** Сколько ждём воркер агента, прежде чем сказать, что он не пришёл. */
const AGENT_JOIN_TIMEOUT_MS = 12_000;

type Phase = "idle" | "connecting" | "live" | "ended";
type Speaker = "agent" | "guest";
type ErrorCode =
  | "mic_denied"
  | "mic_missing"
  | "rate_limited"
  | "unavailable"
  | "agent_missing"
  | "generic";

interface Turn {
  segmentId: string;
  speaker: Speaker;
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

const copy = {
  de: {
    fab: "Assistenten anrufen",
    title: "Basilik",
    subtitle: "KI-Assistent",
    connecting: "Verbindung wird aufgebaut",
    waiting: "Gleich meldet sich der Assistent",
    ended: "Anruf beendet",
    agentSpeaking: "Der Assistent spricht",
    guestSpeaking: "Sie sprechen",
    listening: "Ich höre zu",
    hangUp: "Auflegen",
    callAgain: "Erneut anrufen",
    close: "Schließen",
    you: "Sie",
    agent: "Assistent",
    privacy:
      "Das Gespräch wird nirgends gespeichert und verschwindet mit diesem Fenster.",
    errors: {
      mic_denied:
        "Der Browser hat kein Mikrofon freigegeben. Bitte erlauben und erneut versuchen.",
      mic_missing: "Kein Mikrofon gefunden.",
      rate_limited:
        "Zu viele Anrufe. Bitte versuchen Sie es in einigen Minuten erneut.",
      unavailable:
        "Der Assistent ist gerade nicht erreichbar. Bitte rufen Sie uns an.",
      agent_missing: "Der Assistent ist der Leitung nicht beigetreten.",
      generic: "Der Anruf konnte nicht gestartet werden.",
    },
  },
  ru: {
    fab: "Позвонить ассистенту",
    title: "Basilik",
    subtitle: "ИИ-ассистент",
    connecting: "Устанавливаю соединение",
    waiting: "Ассистент сейчас ответит",
    ended: "Звонок завершён",
    agentSpeaking: "Ассистент говорит",
    guestSpeaking: "Вы говорите",
    listening: "Слушаю вас",
    hangUp: "Завершить",
    callAgain: "Позвонить снова",
    close: "Закрыть",
    you: "Вы",
    agent: "Ассистент",
    privacy: "Разговор нигде не сохраняется и исчезнет вместе с этим окном.",
    errors: {
      mic_denied:
        "Браузер не дал доступ к микрофону. Разрешите его и попробуйте снова.",
      mic_missing: "Микрофон не найден.",
      rate_limited:
        "Слишком много звонков. Повторите попытку через несколько минут.",
      unavailable: "Ассистент сейчас недоступен. Пожалуйста, позвоните нам.",
      agent_missing: "Ассистент не вошёл в разговор.",
      generic: "Не удалось начать звонок.",
    },
  },
  en: {
    fab: "Call the assistant",
    title: "Basilik",
    subtitle: "AI assistant",
    connecting: "Connecting",
    waiting: "The assistant will answer in a moment",
    ended: "Call ended",
    agentSpeaking: "The assistant is speaking",
    guestSpeaking: "You are speaking",
    listening: "Listening",
    hangUp: "Hang up",
    callAgain: "Call again",
    close: "Close",
    you: "You",
    agent: "Assistant",
    privacy:
      "The conversation is never stored and disappears with this window.",
    errors: {
      mic_denied:
        "The browser did not grant microphone access. Allow it and try again.",
      mic_missing: "No microphone found.",
      rate_limited: "Too many calls. Please try again in a few minutes.",
      unavailable: "The assistant is unavailable right now. Please call us.",
      agent_missing: "The assistant did not join the call.",
      generic: "The call could not be started.",
    },
  },
} as const;

/** Ошибка с кодом: текст выбирается уже на языке, выбранном на сайте. */
class CallError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function requestGrant(): Promise<Grant> {
  const response = await fetch("/api/voice-call/token", { method: "POST" });
  if (!response.ok) {
    if (response.status === 429) throw new CallError("rate_limited");
    throw new CallError("unavailable");
  }
  return (await response.json()) as Grant;
}

function errorCode(cause: unknown): ErrorCode {
  if (cause instanceof CallError) return cause.code;
  if (cause instanceof DOMException && cause.name === "NotAllowedError")
    return "mic_denied";
  if (cause instanceof DOMException && cause.name === "NotFoundError")
    return "mic_missing";
  return "generic";
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className ?? "voice-icon"}
      viewBox="0 0 24 24"
    >
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1.2 1.2 0 0 1 1.2-.3c1.3.4 2.7.7 4.1.7.7 0 1.3.6 1.3 1.3V20c0 .7-.6 1.3-1.3 1.3C10.1 21.3 2.7 13.9 2.7 4.7c0-.7.6-1.3 1.3-1.3h3.1c.7 0 1.3.6 1.3 1.3 0 1.4.2 2.8.7 4.1.1.4 0 .9-.3 1.2l-2.2 2.8Z" />
    </svg>
  );
}

function LeafAvatar() {
  return (
    <svg aria-hidden="true" className="voice-avatar-mark" viewBox="0 0 44 44">
      <path d="M35 8C20 9 10 16 9 33c14 2 25-8 26-25Z" />
      <path d="M12 31c6-8 12-13 21-20" />
    </svg>
  );
}

function Equalizer({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={active ? "voice-eq active" : "voice-eq"}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export default function VoiceCall({ language }: { language: Language }) {
  const c = copy[language];

  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<ErrorCode | undefined>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [callDurationSeconds, setCallDurationSeconds] = useState(0);
  const [speaking, setSpeaking] = useState<Speaker | undefined>(undefined);

  const roomRef = useRef<Room | undefined>(undefined);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const identityRef = useRef<string>("");
  const seqRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const callStartedAtRef = useRef<number | undefined>(undefined);

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
      const speaker: Speaker =
        senderIdentity === identityRef.current ? "guest" : "agent";
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

  const hangUp = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = undefined;
    stopTimer();
    setSpeaking(undefined);
    setPhase((current) => (current === "idle" ? "idle" : "ended"));
    if (room) {
      await room.disconnect();
    }
  }, [stopTimer]);

  const startCall = useCallback(async () => {
    setFailure(undefined);
    setTurns([]);
    setSpeaking(undefined);
    stopTimer();
    setCallDurationSeconds(0);
    setPhase("connecting");

    let room: Room | undefined;
    let microphone: LocalAudioTrack | undefined;
    try {
      // Микрофон запрашивается ДО room.connect(), и это не косметика. Пока у origin нет
      // разрешения на микрофон, Chrome подменяет локальные host-кандидаты ICE именами
      // mDNS `.local`; livekit-server их не резолвит и выбрасывает, остаётся только srflx
      // на публичный адрес, который до контейнера не маршрутизируется. ICE зависает в
      // `checking` и через 15 секунд падает с CONNECTION_TIMEOUT. Портал делает наоборот и
      // работает лишь потому, что его origin получил разрешение когда-то раньше.
      microphone = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });

      const grant = await requestGrant();
      identityRef.current = grant.identity;

      room = new Room();

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

      // Кто говорит, берём из уровней звука самого LiveKit, а не угадываем по транскрипту:
      // индикатор совпадает с тем, что слышно в наушниках.
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const agentSpeaks = speakers.some(
          (it) => it.identity !== identityRef.current,
        );
        const guestSpeaks = speakers.some(
          (it) => it.identity === identityRef.current,
        );
        setSpeaking(agentSpeaks ? "agent" : guestSpeaks ? "guest" : undefined);
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) {
          return;
        }
        roomRef.current = undefined;
        stopTimer();
        setSpeaking(undefined);
        setPhase("ended");
      });

      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, info) => {
        void readTranscription(reader, info.identity);
      });

      await room.connect(grant.url, grant.token);
      // Публикуется нижележащая MediaStreamTrack: `LocalAudioTrack` не проходит по типам
      // при `exactOptionalPropertyTypes`, а обёртку LiveKit всё равно строит сам.
      await room.localParticipant.publishTrack(microphone.mediaStreamTrack, {
        source: Track.Source.Microphone,
      });
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
          setFailure("agent_missing");
        }
      }, AGENT_JOIN_TIMEOUT_MS);
    } catch (cause) {
      await room?.disconnect();
      // Если до публикации дело не дошло, `disconnect` дорожку не закроет и индикатор
      // микрофона в браузере остался бы гореть.
      microphone?.stop();
      roomRef.current = undefined;
      stopTimer();
      setPhase("ended");
      setFailure(errorCode(cause));
    }
  }, [readTranscription, startTimer, stopTimer]);

  const close = useCallback(async () => {
    await hangUp();
    setPhase("idle");
    setTurns([]);
    setFailure(undefined);
    setCallDurationSeconds(0);
  }, [hangUp]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearInterval(timerRef.current);
      }
      void roomRef.current?.disconnect();
      roomRef.current = undefined;
    };
  }, []);

  // Новая реплика всегда видна: лента прокручивается к последнему бабблу.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread && turns.length > 0) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    }
  }, [turns]);

  useEffect(() => {
    if (phase === "idle") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, close]);

  const open = phase !== "idle";
  // Заставка держится, пока не пришла первая реплика: соединение обычно готово раньше, чем
  // агент заговорит, и пустая лента в этот момент выглядела бы как сбой.
  const showConnecting =
    (phase === "connecting" || phase === "live") && turns.length === 0;

  const status =
    phase === "connecting"
      ? c.connecting
      : phase === "ended"
        ? c.ended
        : speaking === "agent"
          ? c.agentSpeaking
          : speaking === "guest"
            ? c.guestSpeaking
            : turns.length === 0
              ? c.waiting
              : c.listening;

  return (
    <div className="voice-call" data-phase={phase}>
      <button
        aria-label={c.fab}
        className="voice-fab"
        hidden={open}
        onClick={() => void startCall()}
        type="button"
      >
        <span aria-hidden="true" className="voice-fab-ring" />
        <PhoneIcon />
      </button>

      {open ? (
        <section
          aria-label={`${c.title} — ${c.subtitle}`}
          className="voice-panel"
        >
          <header className="voice-head">
            <span
              className={
                speaking === "agent" ? "voice-avatar talking" : "voice-avatar"
              }
            >
              <LeafAvatar />
            </span>
            <span className="voice-head-text">
              <strong>{c.title}</strong>
              <small>{c.subtitle}</small>
            </span>
            <Equalizer active={speaking === "agent"} />
            <time
              className="voice-timer"
              dateTime={`PT${callDurationSeconds}S`}
            >
              {formatCallDuration(callDurationSeconds)}
            </time>
            <button
              aria-label={c.close}
              className="voice-close"
              onClick={() => void close()}
              type="button"
            >
              ×
            </button>
          </header>

          <p aria-live="polite" className="voice-status">
            {status}
          </p>

          <div className="voice-thread" ref={threadRef}>
            {showConnecting ? (
              <div className="voice-connecting">
                <span aria-hidden="true" className="voice-connecting-orb">
                  <LeafAvatar />
                </span>
                <span aria-hidden="true" className="voice-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : null}

            {turns.map((turn) => (
              <article
                className={`voice-bubble ${turn.speaker}${turn.final ? "" : " interim"}`}
                key={turn.segmentId}
              >
                <span className="voice-bubble-who">
                  {turn.speaker === "agent" ? c.agent : c.you}
                </span>
                <p>{turn.text}</p>
              </article>
            ))}
          </div>

          {failure ? (
            <p className="voice-error" role="alert">
              {c.errors[failure]}
            </p>
          ) : null}

          <div className="voice-actions">
            {phase === "ended" ? (
              <button
                className="voice-again"
                onClick={() => void startCall()}
                type="button"
              >
                <PhoneIcon />
                {c.callAgain}
              </button>
            ) : (
              <>
                <span
                  className={
                    speaking === "guest" ? "voice-mic active" : "voice-mic"
                  }
                >
                  <Equalizer active={speaking === "guest"} />
                  {c.guestSpeaking}
                </span>
                <button
                  aria-label={c.hangUp}
                  className="voice-hangup"
                  onClick={() => void hangUp()}
                  type="button"
                >
                  <PhoneIcon className="voice-icon voice-icon-hangup" />
                </button>
              </>
            )}
          </div>

          <p className="voice-privacy">{c.privacy}</p>
        </section>
      ) : null}

      <div hidden ref={audioHostRef} />
    </div>
  );
}
