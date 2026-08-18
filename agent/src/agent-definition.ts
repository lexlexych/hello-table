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

      // Инструменты строятся после сессии: филлер-фразу произносит она же через
      // ctx.session внутри инструмента. Пул agent_app разделяется сессиями job-процесса.
      const tools = buildTools(config, phrases, database);
      const agent = createGermanAgent(await loadSystemPrompt(), tools);
      await startSessionWithDisclosure(
        session,
        buildStartOptions(agent, ctx.room),
        `${phrases.ai_disclosure} ${phrases.greeting}`,
      );
    },
  });
}
