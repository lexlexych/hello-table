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
  loadAllPrompts,
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
      const [phrasesByLanguage, promptsByLanguage] = await Promise.all([
        loadAllPhrases(config.AGENT_ENABLED_LANGUAGES),
        loadAllPrompts(config.AGENT_ENABLED_LANGUAGES),
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
      const agent = createRestaurantAgent(
        resourceFor(promptsByLanguage, state.language),
        tools,
      );

      /**
       * Переключение языка (PROJECT.md §4.1).
       *
       * Подписка именно на `UserInputTranscribed`, а не на хук `Agent.onUserTurnCompleted`:
       * в @livekit/agents 1.6.4 копия контекста для ответа снимается ДО вызова хука, поэтому
       * заменённые в хуке инструкции подействовали бы только со следующей реплики — агент
       * ответил бы на смену языка ещё на старом. Это событие приходит раньше фиксации хода,
       * а `updateInstructions` правит контекст синхронно, так что новый промпт успевает в
       * ответ на ту же самую реплику.
       */
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
        tts.updateOptions({ language, voiceId: voiceIdFor(config, language) });
        void agent
          .updateInstructions(resourceFor(promptsByLanguage, language))
          .catch((error: unknown) => {
            log().error({ error }, "agent_language_prompt_update_failed");
          });
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
