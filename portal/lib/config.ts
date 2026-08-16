import { z } from "zod";

/**
 * bcrypt-хеш: `$2a$` / `$2b$` / `$2y$`, двузначная стоимость, 53 символа соли и хеша.
 * Проверка формата ловит самую частую ошибку конфигурации — пароль, записанный в открытом виде.
 */
const bcryptHash = z
  .string()
  .regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, "must be a bcrypt hash");

export const configSchema = z.object({
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD_HASH: bcryptHash,
  OPERATOR_USERNAME: z.string().min(1),
  OPERATOR_PASSWORD_HASH: bcryptHash,
  // PROJECT.md §7.1: 32+ байта для подписи cookie.
  SESSION_SECRET: z.string().min(32),

  LIVEKIT_URL: z.url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  // Локально портал работает по http, и с флагом Secure браузер cookie не сохранит.
  // За Caddy (итерация 12) значение обязано стать true.
  PORTAL_COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type PortalConfig = z.infer<typeof configSchema>;

/**
 * Валидирует конфигурацию портала. Текст ошибки содержит имена полей и причины,
 * но никогда не содержит значений — иначе секреты утекли бы в лог падения (PROJECT.md §0.4).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): PortalConfig {
  const parsed = configSchema.safeParse(env);
  if (parsed.success) {
    return parsed.data;
  }

  const issues = parsed.error.issues.map((issue) => {
    const field = issue.path.join(".") || "configuration";
    return `- ${field}: ${issue.message}`;
  });
  throw new Error(`Invalid portal configuration:\n${issues.join("\n")}`);
}

let cached: PortalConfig | undefined;

/** Конфигурация процесса. При некорректном окружении портал падает, а не работает наполовину. */
export function getConfig(): PortalConfig {
  cached ??= loadConfig();
  return cached;
}
