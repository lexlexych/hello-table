import {
  AgentSessionEventTypes,
  defineAgent,
  log,
  type VAD,
  voice,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import type { Config } from "./config.ts";
import { LanguageTracker } from "./language.ts";
import {
  buildSessionOptions,
  buildStartOptions,
  buildStt,
  buildTts,
  createRestaurantAgent,
  loadAllPhrases,
  loadSystemPrompt,
  resourceFor,
  type SessionLanguageState,
  voiceIdFor,
} from "./session.ts";
import { startSessionWithDisclosure } from "./startup.ts";
import { attachTelemetry } from "./telemetry.ts";
import { createAgentDatabase } from "./tools/database.ts";
import { buildTools } from "./tools/index.ts";

interface ProcessData {
  vad?: VAD;
}

/** Creates the worker definition around one config object validated by the worker entrypoint. */
export function createAgent(config: Config) {
  const database = createAgentDatabase(
    config.AGENT_DATABASE_URL,
    config.AGENT_DATABASE_TIMEOUT_MS,
  );
  return defineAgent<ProcessData>({
    prewarm: async (proc) => {
      // Silero больше не нужен распознаванию — ElevenLabs Scribe realtime стримит сам, — но
      // остаётся источником эндпоинтинга и прерываний для сессии.
      proc.userData.vad = await silero.VAD.load();
    },

    entry: async (ctx) => {
      const vad = ctx.proc.userData.vad;
      if (vad === undefined) {
        throw new Error("Silero VAD was not initialized during prewarm");
      }

      const tracker = new LanguageTracker({
        initial: config.AGENT_DEFAULT_LANGUAGE,
        enabled: config.AGENT_ENABLED_LANGUAGES,
        switchAfter: config.AGENT_LANGUAGE_SWITCH_AFTER,
      });
      // Ресурсы всех включённых языков грузятся один раз здесь: переключение посреди
      // разговора не должно ждать чтения файлов.
      const [phrasesByLanguage, multilingualPrompt] = await Promise.all([
        loadAllPhrases(config.AGENT_ENABLED_LANGUAGES),
        // Один канонический промпт для LLM: язык ответа определяется репликой гостя,
        // а не состоянием STT/TTS. Английская версия используется только как язык
        // инструкций модели и не задаёт язык её ответа.
        loadSystemPrompt("en"),
      ]);

      const state: SessionLanguageState = {
        language: tracker.current,
        phrases: resourceFor(phrasesByLanguage, tracker.current),
      };

      const tts = buildTts(config, state.language);
      const session = new voice.AgentSession(
        buildSessionOptions(config, vad, buildStt(config), tts),
      );
      attachTelemetry(session, ctx, {
        logTranscripts: config.AGENT_LOG_TRANSCRIPTS,
      });

      let recoveryPhraseSpoken = false;
      session.on(AgentSessionEventTypes.Error, () => {
        if (recoveryPhraseSpoken) {
          return;
        }
        recoveryPhraseSpoken = true;
        session.say(state.phrases.error_unavailable, {
          addToChatCtx: false,
          allowInterruptions: false,
        });
      });

      // Инструменты строятся после сессии: филлер-фразу произносит она же через
      // ctx.session внутри инструмента. Пул agent_app разделяется сессиями job-процесса.
      const tools = buildTools(config, state, database);
      const agent = createRestaurantAgent(multilingualPrompt, tools);

      /** Переключение фиксированных i18n-ресурсов и голосового профиля (§4.1). */
      session.on(AgentSessionEventTypes.UserInputTranscribed, (event) => {
        if (!event.isFinal) {
          return;
        }
        const { language, changed } = tracker.observe(event.language);
        if (!changed) {
          return;
        }

        state.language = language;
        state.phrases = resourceFor(phrasesByLanguage, language);
        tts.updateOptions({ voiceId: voiceIdFor(config, language) });
        // В лог уходит только код языка: транскрипты логировать запрещено (§0.4).
        log().info({ language }, "agent_language_switched");
      });

      await startSessionWithDisclosure(
        session,
        buildStartOptions(agent, ctx.room),
        `${state.phrases.ai_disclosure} ${state.phrases.greeting}`,
      );
    },
  });
}
