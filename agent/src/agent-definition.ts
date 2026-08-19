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
import { getAgentRuntimeSettings } from "./runtime-settings.ts";
import {
  buildPipelineSessionOptions,
  buildRealtimeSessionOptions,
  buildStartOptions,
  buildStt,
  buildTts,
  createRestaurantAgent,
  loadAllPhrases,
  loadSystemPrompt,
  resourceFor,
  type SessionLanguageState,
  ttsVoiceFor,
} from "./session.ts";
import {
  startRealtimeSessionWithDisclosure,
  startSessionWithDisclosure,
} from "./startup.ts";
import { attachTelemetry } from "./telemetry.ts";
import { createAgentDatabase } from "./tools/database.ts";
import { buildTools } from "./tools/index.ts";

interface ProcessData {
  pipelineVad?: Promise<VAD>;
}

/** Creates the worker definition around one config object validated by the worker entrypoint. */
export function createAgent(config: Config) {
  const database = createAgentDatabase(
    config.AGENT_DATABASE_URL,
    config.AGENT_DATABASE_TIMEOUT_MS,
  );
  return defineAgent<ProcessData>({
    entry: async (ctx) => {
      const { voiceMode } = await getAgentRuntimeSettings(
        database,
        config.RESTAURANT_ID,
      );
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
        language: config.AGENT_DEFAULT_LANGUAGE,
        phrases: resourceFor(
          phrasesByLanguage,
          config.AGENT_DEFAULT_LANGUAGE,
        ),
      };

      const tools = buildTools(
        config,
        state,
        phrasesByLanguage,
        database,
        voiceMode,
      );
      const agent = createRestaurantAgent(multilingualPrompt, tools);
      log().info({ voiceMode }, "agent_voice_mode_selected");

      if (voiceMode === "realtime") {
        const session = new voice.AgentSession(
          buildRealtimeSessionOptions(config),
        );
        attachTelemetry(session, ctx, {
          logTranscripts: config.AGENT_LOG_TRANSCRIPTS,
        });
        await startRealtimeSessionWithDisclosure(
          session,
          buildStartOptions(agent, ctx.room),
          `${state.phrases.ai_disclosure} ${state.phrases.greeting}`,
        );
        return;
      }

      // Silero/STT/TTS создаются только после выбора pipeline. Promise кешируется на
      // процесс, чтобы следующие pipeline-звонки не загружали модель повторно.
      const tracker = new LanguageTracker({
        initial: config.AGENT_DEFAULT_LANGUAGE,
        enabled: config.AGENT_ENABLED_LANGUAGES,
        switchAfter: config.AGENT_LANGUAGE_SWITCH_AFTER,
      });
      ctx.proc.userData.pipelineVad ??= silero.VAD.load();
      const vad = await ctx.proc.userData.pipelineVad;
      const tts = buildTts(config, state.language);
      const session = new voice.AgentSession(
        buildPipelineSessionOptions(config, vad, buildStt(config), tts),
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
        tts.updateOptions({ voice: ttsVoiceFor(config, language) });
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
