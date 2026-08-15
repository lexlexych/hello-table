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
      attachTelemetry(session, ctx);

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

      const agent = createGermanAgent(await loadSystemPrompt());
      await startSessionWithDisclosure(
        session,
        buildStartOptions(agent, ctx.room),
        `${phrases.ai_disclosure} ${phrases.greeting}`,
      );
    },
  });
}
