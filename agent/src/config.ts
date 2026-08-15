import { z } from "zod";

export const configSchema = z
  .object({
    LIVEKIT_URL: z.url(),
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),

    MISTRAL_API_KEY: z.string().min(1),
    STT_MODEL: z
      .string()
      .min(1)
      .default("voxtral-mini-transcribe-realtime-2602"),
    LLM_MODEL: z.string().min(1).default("mistral-large-latest"),

    ELEVENLABS_API_KEY: z.string().min(1),
    ELEVENLABS_VOICE_ID: z.string().min(1),
    ELEVENLABS_MODEL: z.string().min(1),
    ELEVENLABS_BASE_URL: z.url().optional(),

    AGENT_LANGUAGE: z.literal("de").default("de"),
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
