import { languageSchema } from "@hello-table/contracts";
import { z } from "zod";

/**
 * Голоса ElevenLabs на язык. Пустое значение означает «взять общий ELEVENLABS_VOICE_ID»:
 * на одном мультиязычном голосе система работает целиком, а разные голоса на языки —
 * вопрос бренда, а не техники.
 */
const optionalVoiceId = z
  .string()
  .trim()
  .optional()
  .transform((value) =>
    value === undefined || value === "" ? undefined : value,
  );

export const configSchema = z
  .object({
    LIVEKIT_URL: z.url(),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),

    MISTRAL_API_KEY: z.string().min(1),
    LLM_MODEL: z.string().min(1).default("mistral-large-latest"),

    ELEVENLABS_API_KEY: z.string().min(1),
    ELEVENLABS_VOICE_ID: z.string().min(1),
    ELEVENLABS_VOICE_ID_DE: optionalVoiceId,
    ELEVENLABS_VOICE_ID_RU: optionalVoiceId,
    ELEVENLABS_VOICE_ID_EN: optionalVoiceId,
    ELEVENLABS_MODEL: z.string().min(1),
    ELEVENLABS_BASE_URL: z.url().optional(),

    /**
     * Распознавание речи тоже идёт через ElevenLabs. Пакетные модели Scribe объявляют
     * `streaming: false`, и разговор с ними развалится в рантайме, поэтому они
     * отвергаются здесь, а не выясняются на звонке.
     */
    STT_MODEL: z
      .string()
      .min(1)
      .default("scribe_v2_realtime")
      .refine((value) => value !== "scribe_v1" && value !== "scribe_v2", {
        message:
          "must be a realtime model such as scribe_v2_realtime: batch Scribe models do not stream",
      }),

    /**
     * Сколько миллисекунд тишины считается концом реплики гостя.
     *
     * Это порог **серверного VAD ElevenLabs**, а не эндпоинтинга фреймворка. Именно он
     * заставляет Scribe закоммитить сегмент и отдать финальную расшифровку: без
     * серверного VAD плагин работает в режиме `commit_strategy=manual` и не коммитит
     * никогда, потому что фреймворк не шлёт ему FLUSH_SENTINEL. Разбор —
     * docs/architecture.md.
     */
    STT_VAD_SILENCE_THRESHOLD_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(5_000)
      .default(500),

    /** Язык приветствия и объявления об ИИ (PROJECT.md §4.1 п.1–2). */
    AGENT_DEFAULT_LANGUAGE: languageSchema.default("ru"),
    /** Языки, на которые агенту разрешено переключаться (§5.1 enabled_languages). */
    AGENT_ENABLED_LANGUAGES: z
      .string()
      .default("de,ru,en")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      )
      .pipe(
        z
          .array(languageSchema)
          .min(1)
          .refine((list) => new Set(list).size === list.length, {
            message: "must not repeat a language",
          }),
      ),
    /**
     * Сколько подряд идущих реплик на другом языке нужно, чтобы переключиться.
     * Порог, а не жёсткая единица: §4.1 требует не переключаться от одного слова.
     */
    AGENT_LANGUAGE_SWITCH_AFTER: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(2),

    AGENT_TURN_DETECTOR: z
      .enum(["multilingual", "off"])
      .default("multilingual"),
    AGENT_MIN_ENDPOINTING_DELAY_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(2_000)
      .default(500),
    AGENT_MAX_ENDPOINTING_DELAY_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(10_000)
      .default(3_000),

    /**
     * Пишет в лог тексты реплик (STT и ответ модели) вместе с задержками звеньев.
     * Выключено по умолчанию: PROJECT.md §0.4 запрещает логировать персональные данные.
     * Включать только для локальной отладки на вымышленных данных.
     */
    AGENT_LOG_TRANSCRIPTS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    /**
     * Ресторан, от имени которого работает воркер. Проверяется формой строки, а не
     * `z.uuid()`: zod 4 требует биты версии по RFC 9562, а идентификаторы демо-данных
     * в db/seed.sql рукописные (`10000000-0000-…`) и такую проверку не проходят.
     */
    RESTAURANT_ID: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        "must be a UUID-shaped identifier",
      ),

    /**
     * Прямая строка подключения инструментов. Имя роли проверяется здесь, чтобы
     * app_owner или portal_app нельзя было случайно запустить в runtime агента.
     */
    AGENT_DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          ["postgres:", "postgresql:"].includes(new URL(value).protocol),
        {
          message: "must use the postgres or postgresql protocol",
        },
      )
      .refine((value) => new URL(value).username === "agent_app", {
        message: "must connect as agent_app",
      })
      .refine((value) => new URL(value).password.length > 0, {
        message: "must include the agent_app password",
      }),
    AGENT_DATABASE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(30_000)
      .default(8_000),

    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .superRefine((config, context) => {
    if (
      config.AGENT_MIN_ENDPOINTING_DELAY_MS >
      config.AGENT_MAX_ENDPOINTING_DELAY_MS
    ) {
      context.addIssue({
        code: "custom",
        path: ["AGENT_MIN_ENDPOINTING_DELAY_MS"],
        message: "must not exceed AGENT_MAX_ENDPOINTING_DELAY_MS",
      });
    }

    if (
      !config.AGENT_ENABLED_LANGUAGES.includes(config.AGENT_DEFAULT_LANGUAGE)
    ) {
      context.addIssue({
        code: "custom",
        path: ["AGENT_DEFAULT_LANGUAGE"],
        message: "must be listed in AGENT_ENABLED_LANGUAGES",
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

/**
 * Validates configuration without loading an env file. Error output contains field names and
 * validation messages only; environment values (including secrets) are never included.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(env);
  if (parsed.success) {
    return parsed.data;
  }

  const issues = parsed.error.issues.map((issue) => {
    const field = issue.path.join(".") || "configuration";
    return `- ${field}: ${issue.message}`;
  });
  throw new Error(`Invalid agent configuration:\n${issues.join("\n")}`);
}
