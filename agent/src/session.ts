import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DOMAIN_TOOL_ERRORS,
  TRANSPORT_TOOL_ERRORS,
} from "@hello-table/contracts";
import { type llm, type VAD, voice } from "@livekit/agents";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as mistral from "@livekit/agents-plugin-mistralai";
import type { Room } from "@livekit/rtc-node";
import { parse } from "yaml";
import { z } from "zod";
import type { Config } from "./config.ts";

const germanPhrasesSchema = z.object({
  greeting: z.string().trim().min(1),
  ai_disclosure: z.string().trim().min(1),
  goodbye: z.string().trim().min(1),
  error_unavailable: z.string().trim().min(1),
  filler_checking: z.string().trim().min(1),
  filler_booking: z.string().trim().min(1),
  filler_sending: z.string().trim().min(1),
  /**
   * Фраза на каждый код ошибки инструмента. Ключи проверяются схемой контрактов, а не
   * перечисляются здесь второй раз: пропущенный код иначе всплыл бы только в разговоре.
   */
  tool_errors: z.record(
    z.enum([...DOMAIN_TOOL_ERRORS, ...TRANSPORT_TOOL_ERRORS]),
    z.string().trim().min(1),
  ),
});

export type GermanPhrases = z.infer<typeof germanPhrasesSchema>;

/** Options for the realtime German voice session. All providers receive keys explicitly. */
export function buildSessionOptions(
  cfg: Config,
  vad: VAD,
): voice.AgentSessionOptions {
  const ttsOptions: elevenlabs.TTSOptions = {
    apiKey: cfg.ELEVENLABS_API_KEY,
    voiceId: cfg.ELEVENLABS_VOICE_ID,
    model: cfg.ELEVENLABS_MODEL,
    language: "de",
    enableLogging: false,
  };
  if (cfg.ELEVENLABS_BASE_URL !== undefined) {
    ttsOptions.baseURL = cfg.ELEVENLABS_BASE_URL;
  }

  const turnDetection =
    cfg.AGENT_TURN_DETECTOR === "multilingual"
      ? new livekit.turnDetector.MultilingualModel()
      : "vad";

  return {
    stt: new mistral.STT({
      apiKey: cfg.MISTRAL_API_KEY,
      model: cfg.STT_MODEL,
      vad,
    }),
    vad,
    llm: new mistral.LLM({
      apiKey: cfg.MISTRAL_API_KEY,
      model: cfg.LLM_MODEL,
    }),
    tts: new elevenlabs.TTS(ttsOptions),
    turnHandling: {
      turnDetection,
      endpointing: {
        mode: "fixed",
        minDelay: cfg.AGENT_MIN_ENDPOINTING_DELAY_MS,
        maxDelay: cfg.AGENT_MAX_ENDPOINTING_DELAY_MS,
      },
    },
  };
}

/**
 * The only place where session start options are assembled. `record: false` is a privacy and
 * legal invariant: without it LiveKit can enable audio, transcript, trace, and log recording from
 * job settings outside this process.
 */
export function buildStartOptions(
  agent: voice.Agent,
  room: Room,
): { agent: voice.Agent; room: Room; record: false } {
  return { agent, room, record: false };
}

/** Creates the German-only agent of this prototype together with its n8n-backed tools. */
export function createGermanAgent(
  systemPrompt: string,
  tools: llm.ToolContextLike,
): voice.Agent {
  return new voice.Agent({ instructions: systemPrompt, tools });
}

async function readPromptFile(name: string): Promise<string> {
  const path = fileURLToPath(new URL(`./prompts/${name}`, import.meta.url));
  const text = (await readFile(path, "utf8")).trim();
  if (!text) {
    throw new Error(`prompt file is empty: ${name}`);
  }
  return text;
}

/**
 * Собирает системный промпт из двух частей: инструкции поведения и правил ресторана.
 *
 * Правила лежат отдельным файлом, потому что это данные заказчика, а не поведение агента:
 * ресторан меняет условия отмены или corkage, не трогая инструкции. Всё остальное — часы
 * работы, меню, свободные столики — агент узнаёт инструментами, а не из промпта.
 */
export async function loadSystemPrompt(language = "de"): Promise<string> {
  const [instructions, houseRules] = await Promise.all([
    readPromptFile(`system.${language}.md`),
    readPromptFile(`basilik.${language}.md`),
  ]);
  return `${instructions}\n\n---\n\n${houseRules}`;
}

export async function loadGermanPhrases(): Promise<GermanPhrases> {
  const path = fileURLToPath(new URL("./i18n/de.yaml", import.meta.url));
  const contents: unknown = parse(await readFile(path, "utf8"));
  return germanPhrasesSchema.parse(contents);
}
