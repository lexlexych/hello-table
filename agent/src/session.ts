import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DOMAIN_TOOL_ERRORS,
  type Language,
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

/** Голос ElevenLabs для языка; при незаполненном языковом голосе — общий. */
export function voiceIdFor(cfg: Config, language: Language): string {
  const perLanguage: Record<Language, string | undefined> = {
    de: cfg.ELEVENLABS_VOICE_ID_DE,
    ru: cfg.ELEVENLABS_VOICE_ID_RU,
    en: cfg.ELEVENLABS_VOICE_ID_EN,
  };
  return perLanguage[language] ?? cfg.ELEVENLABS_VOICE_ID;
}

/**
 * Распознавание речи. Язык намеренно НЕ задаётся: только без `languageCode` плагин
 * включает `include_language_detection=true`, и распознанный язык доезжает до
 * `UserInputTranscribed.language` — на нём построено переключение языка (PROJECT.md §4.1).
 */
export function buildStt(cfg: Config): elevenlabs.STT {
  const sttOptions: elevenlabs.STTOptions = {
    apiKey: cfg.ELEVENLABS_API_KEY,
    model: cfg.STT_MODEL,
    // По умолчанию плагин шлёт enable_logging=true, то есть провайдер хранит аудио и
    // расшифровки у себя. PROJECT.md §0.4 и §11.3 этого не допускают.
    enableLogging: false,
    // Без пометок вида «(laughter)» в тексте: он уходит в LLM как реплика гостя.
    tagAudioEvents: false,
    /**
     * Серверный VAD ОБЯЗАТЕЛЕН, без него агент не отвечает вообще.
     *
     * Заданный `serverVad` переводит соединение в `commit_strategy=vad`, и Scribe сам
     * закрывает сегмент по тишине: присылает `committed_transcript`, из которого плагин
     * делает FINAL_TRANSCRIPT и END_OF_SPEECH. Без него режим `manual`, а команду
     * коммита плагин шлёт только на FLUSH_SENTINEL во входном потоке — фреймворк его
     * не отправляет никогда. В итоге приходят только промежуточные расшифровки, реплика
     * гостя не закрывается, ход не фиксируется и агент молчит, дописывая следующую фразу
     * к той же незакрытой. Разбор — docs/architecture.md.
     */
    serverVad: {
      vadSilenceThresholdSecs: cfg.STT_VAD_SILENCE_THRESHOLD_MS / 1_000,
    },
  };
  if (cfg.ELEVENLABS_BASE_URL !== undefined) {
    sttOptions.baseURL = cfg.ELEVENLABS_BASE_URL;
  }
  return new elevenlabs.STT(sttOptions);
}

/** Синтез речи на стартовом языке; дальше язык и голос меняет `TTS.updateOptions`. */
export function buildTts(cfg: Config, language: Language): elevenlabs.TTS {
  const ttsOptions: elevenlabs.TTSOptions = {
    apiKey: cfg.ELEVENLABS_API_KEY,
    voiceId: voiceIdFor(cfg, language),
    model: cfg.ELEVENLABS_MODEL,
    language,
    enableLogging: false,
  };
  if (cfg.ELEVENLABS_BASE_URL !== undefined) {
    ttsOptions.baseURL = cfg.ELEVENLABS_BASE_URL;
  }
  return new elevenlabs.TTS(ttsOptions);
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
  stt: elevenlabs.STT,
  tts: elevenlabs.TTS,
): voice.AgentSessionOptions {
  const turnDetection =
    cfg.AGENT_TURN_DETECTOR === "multilingual"
      ? new livekit.turnDetector.MultilingualModel()
      : "vad";

  return {
    stt,
    vad,
    llm: new mistral.LLM({
      apiKey: cfg.MISTRAL_API_KEY,
      model: cfg.LLM_MODEL,
    }),
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

export async function loadAllPrompts(
  languages: readonly Language[],
): Promise<Partial<Record<Language, string>>> {
  const loaded = await Promise.all(
    languages.map(
      async (language) => [language, await loadSystemPrompt(language)] as const,
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
