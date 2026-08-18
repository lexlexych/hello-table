import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DOMAIN_TOOL_ERRORS,
  type Language,
  TRANSPORT_TOOL_ERRORS,
} from "@hello-table/contracts";
import { type llm, type VAD, voice } from "@livekit/agents";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as openai from "@livekit/agents-plugin-openai";
import type { Room } from "@livekit/rtc-node";
import { parse } from "yaml";
import { z } from "zod";
import type { Config } from "./config.ts";

const phrasesSchema = z.object({
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

export type Phrases = z.infer<typeof phrasesSchema>;

/**
 * Язык разговора и его ресурсы — одна изменяемая ссылка на всю сессию.
 *
 * Инструменты и обработчики читают её в момент вызова, а не получают снимок при сборке:
 * иначе после переключения языка филлер-фраза и текст ошибки остались бы на старом языке.
 */
export interface SessionLanguageState {
  language: Language;
  phrases: Phrases;
}

/** Голос OpenAI TTS для языка; при незаполненном языковом голосе — общий. */
export function ttsVoiceFor(
  cfg: Config,
  language: Language,
): Config["TTS_VOICE"] {
  const perLanguage: Record<Language, Config["TTS_VOICE"] | undefined> = {
    de: cfg.TTS_VOICE_DE,
    ru: cfg.TTS_VOICE_RU,
    en: cfg.TTS_VOICE_EN,
  };
  return perLanguage[language] ?? cfg.TTS_VOICE;
}

/**
 * Распознавание речи через OpenAI Realtime transcription API.
 *
 * В `language` передаются все включённые языки как hints. `gpt-transcribe` всё равно
 * возвращает фактически распознанный язык в финальном событии; LiveKit переносит его в
 * `UserInputTranscribed.language`, на котором построено переключение ресурсов (§4.1).
 */
export function buildStt(cfg: Config): openai.STT {
  const sttOptions: Partial<openai.STTOptions> = {
    apiKey: cfg.OPENAI_API_KEY,
    model: cfg.STT_MODEL,
    useRealtime: true,
    language: cfg.AGENT_ENABLED_LANGUAGES,
    detectLanguage: false,
    turnDetection: {
      type: "server_vad",
      silence_duration_ms: cfg.STT_VAD_SILENCE_THRESHOLD_MS,
    },
  };
  if (cfg.OPENAI_BASE_URL !== undefined) {
    sttOptions.baseURL = cfg.OPENAI_BASE_URL;
  }
  return new openai.STT(sttOptions);
}

/**
 * Синтез речи моделью OpenAI `tts-1`.
 *
 * Модель определяет язык по тексту ответа GPT. Аргумент `language` нужен только для
 * выбора голосового профиля.
 */
export function buildTts(cfg: Config, language: Language): openai.TTS {
  const ttsOptions: Partial<openai.TTSOptions> = {
    apiKey: cfg.OPENAI_API_KEY,
    voice: ttsVoiceFor(cfg, language),
    model: cfg.TTS_MODEL,
  };
  if (cfg.OPENAI_BASE_URL !== undefined) {
    ttsOptions.baseURL = cfg.OPENAI_BASE_URL;
  }
  return new openai.TTS(ttsOptions);
}

/**
 * Options for the realtime voice session. All providers receive keys explicitly.
 *
 * STT и TTS передаются готовыми, а не создаются здесь: на объект TTS нужна ссылка, чтобы
 * переключать язык и голос по ходу разговора.
 */
export function buildSessionOptions(
  cfg: Config,
  vad: VAD,
  stt: openai.STT,
  tts: openai.TTS,
): voice.AgentSessionOptions {
  const turnDetection =
    cfg.AGENT_TURN_DETECTOR === "multilingual"
      ? new livekit.turnDetector.MultilingualModel()
      : "vad";

  const llmOptions: openai.LLMOptions = {
    apiKey: cfg.OPENAI_API_KEY,
    model: cfg.LLM_MODEL,
    reasoningEffort: cfg.LLM_REASONING_EFFORT,
    // Chat Completions не должен создавать сохраняемое состояние разговора.
    store: false,
  };
  if (cfg.OPENAI_BASE_URL !== undefined) {
    llmOptions.baseURL = cfg.OPENAI_BASE_URL;
  }

  return {
    stt,
    vad,
    llm: new openai.LLM(llmOptions),
    tts,
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

/** Creates the restaurant agent together with its registered tools. */
export function createRestaurantAgent(
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
export async function loadSystemPrompt(
  language: Language = "de",
): Promise<string> {
  const [instructions, houseRules] = await Promise.all([
    readPromptFile(`system.${language}.md`),
    readPromptFile(`basilik.${language}.md`),
  ]);
  return `${instructions}\n\n---\n\n${houseRules}`;
}

export async function loadPhrases(language: Language): Promise<Phrases> {
  const path = fileURLToPath(
    new URL(`./i18n/${language}.yaml`, import.meta.url),
  );
  const contents: unknown = parse(await readFile(path, "utf8"));
  return phrasesSchema.parse(contents);
}

/**
 * Грузит ресурсы всех включённых языков разом при старте сессии.
 *
 * Так недостающий файл или пропущенный ключ роняет сессию сразу и громко, а не в момент
 * переключения языка посреди разговора с гостем. Тип частичный, потому что у ресторана
 * может быть включено меньше трёх языков.
 */
export async function loadAllPhrases(
  languages: readonly Language[],
): Promise<Partial<Record<Language, Phrases>>> {
  const loaded = await Promise.all(
    languages.map(
      async (language) => [language, await loadPhrases(language)] as const,
    ),
  );
  return Object.fromEntries(loaded);
}

/**
 * Достаёт ресурс включённого языка. Отсутствие означает рассогласование конфига и
 * загрузки — падаем, а не отвечаем гостю пустой строкой.
 */
export function resourceFor<T>(
  resources: Partial<Record<Language, T>>,
  language: Language,
): T {
  const value = resources[language];
  if (value === undefined) {
    throw new Error(`language resource is missing for ${language}`);
  }
  return value;
}
