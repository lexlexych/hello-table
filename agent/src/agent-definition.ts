import {
  AgentSessionEventTypes,
  defineAgent,
  log,
  type VAD,
  voice,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import type { Config } from "./config.ts";
import { LanguageTracker, languageForTranscript } from "./language.ts";
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
import {
  loadRussianStartupAudio,
  loadRussianTurnFillers,
  streamAudioFrames,
} from "./startup-audio.ts";
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
    // Silero грузится здесь, а не в `entry`, потому что инициализация нативного
    // onnxruntime блокирует event loop дочернего процесса на секунды. Внутри джоба это
    // означает, что процесс не успевает ответить на пинг родителя, и фреймворк убивает его
    // по `ORPHANED_TIMEOUT` (15 с, зашито в @livekit/agents) ещё до входа в комнату —
    // разбор в docs/architecture.md. `prewarm` выполняется в простаивающем процессе до
    // звонка, поэтому блокировка никого не задевает.
    prewarm: async (proc) => {
      proc.userData.pipelineVad ??= silero.VAD.load();
      await proc.userData.pipelineVad;
    },
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
        phrases: resourceFor(phrasesByLanguage, config.AGENT_DEFAULT_LANGUAGE),
      };
      const startupText = `${state.phrases.ai_disclosure} ${state.phrases.greeting}`;
      const russianStartupAudio =
        state.language === "ru" ? await loadRussianStartupAudio() : undefined;
      const russianTurnFillers =
        voiceMode === "pipeline" &&
        config.AGENT_ENABLED_LANGUAGES.includes("ru")
          ? await loadRussianTurnFillers()
          : undefined;
      let nextRussianTurnFiller = 0;

      const nextTurnFiller =
        russianTurnFillers === undefined
          ? undefined
          : () => {
              if (state.language !== "ru") {
                return undefined;
              }
              const frames = russianTurnFillers[nextRussianTurnFiller];
              if (frames === undefined) {
                return undefined;
              }
              nextRussianTurnFiller =
                (nextRussianTurnFiller + 1) % russianTurnFillers.length;
              return streamAudioFrames(frames);
            };

      const tools = buildTools(
        config,
        state,
        phrasesByLanguage,
        database,
        voiceMode,
      );
      const agent = createRestaurantAgent(
        multilingualPrompt,
        tools,
        nextTurnFiller,
      );
      log().info({ voiceMode }, "agent_voice_mode_selected");

      if (voiceMode === "realtime") {
        const session = new voice.AgentSession(
          buildRealtimeSessionOptions(config),
        );
        attachTelemetry(session, ctx, {
          logTranscripts: config.AGENT_LOG_TRANSCRIPTS,
        });
        if (russianStartupAudio !== undefined) {
          await startSessionWithDisclosure(
            session,
            buildStartOptions(agent, ctx.room),
            startupText,
            streamAudioFrames(russianStartupAudio),
          );
        } else {
          await startRealtimeSessionWithDisclosure(
            session,
            buildStartOptions(agent, ctx.room),
            startupText,
          );
        }
        return;
      }

      // STT/TTS создаются только после выбора pipeline. Silero к этому моменту уже загружен
      // `prewarm`; промис кешируется на процесс, поэтому следующие звонки его переиспользуют.
      // Realtime-режим VAD не использует, но прогрев всё равно безусловный: он идёт вне
      // звонка и стоит только памяти простаивающего процесса.
      const tracker = new LanguageTracker({
        initial: config.AGENT_DEFAULT_LANGUAGE,
        enabled: config.AGENT_ENABLED_LANGUAGES,
        switchAfter: config.AGENT_LANGUAGE_SWITCH_AFTER,
      });
      // Обычно промис уже разрешён `prewarm`. `??=` оставлен на случай, когда процесс
      // джоба стартовал без прогрева: тогда цена — та же задержка, что была раньше.
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
        const { language, changed } = tracker.observe(
          languageForTranscript(event.transcript, event.language),
        );
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
        startupText,
        russianStartupAudio === undefined
          ? undefined
          : streamAudioFrames(russianStartupAudio),
      );
    },
  });
}
