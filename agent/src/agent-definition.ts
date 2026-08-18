import {
  AgentSessionEventTypes,
  defineAgent,
  type VAD,
  voice,
} from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import type { Config } from "./config.ts";
import {
  buildSessionOptions,
  buildStartOptions,
  createGermanAgent,
  loadGermanPhrases,
  loadSystemPrompt,
} from "./session.ts";
import { startSessionWithDisclosure } from "./startup.ts";
import { attachTelemetry } from "./telemetry.ts";
import { buildTools } from "./tools/index.ts";

interface ProcessData {
  vad?: VAD;
}

/** Creates the worker definition around one config object validated by the worker entrypoint. */
export function createAgent(config: Config) {
  return defineAgent<ProcessData>({
    prewarm: async (proc) => {
      proc.userData.vad = await silero.VAD.load();
    },

    entry: async (ctx) => {
      const vad = ctx.proc.userData.vad;
      if (vad === undefined) {
        throw new Error("Silero VAD was not initialized during prewarm");
      }

      const phrases = await loadGermanPhrases();
      const session = new voice.AgentSession(buildSessionOptions(config, vad));
      attachTelemetry(session, ctx, {
        logTranscripts: config.AGENT_LOG_TRANSCRIPTS,
      });

      let recoveryPhraseSpoken = false;
      session.on(AgentSessionEventTypes.Error, () => {
        if (recoveryPhraseSpoken) {
          return;
        }
        recoveryPhraseSpoken = true;
        session.say(phrases.error_unavailable, {
          addToChatCtx: false,
          allowInterruptions: false,
        });
      });

      // Инструменты строятся после сессии: филлер-фразу произносит она же, через
      // ctx.session внутри инструмента. Идентификатор разговора — имя комнаты LiveKit,
      // персональных данных в нём нет.
      const tools = buildTools(config, phrases, ctx.room.name ?? ctx.job.id);
      const agent = createGermanAgent(await loadSystemPrompt(), tools);
      await startSessionWithDisclosure(
        session,
        buildStartOptions(agent, ctx.room),
        `${phrases.ai_disclosure} ${phrases.greeting}`,
      );
    },
  });
}
