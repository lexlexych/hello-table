import postgres from "postgres";
import { assertLocalDatabase } from "../../scripts/db/lib/config.ts";
import { migrate } from "../../scripts/db/migrate.ts";

const secretNames = [
  "MISTRAL_API_KEY",
  "ELEVENLABS_API_KEY",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "N8N_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "SESSION_SECRET",
];
export default async function setup() {
  for (const name of secretNames) delete process.env[name];
  const base =
    process.env.TEST_DATABASE_URL ??
    "postgres://app_owner:app_owner@127.0.0.1:55432/postgres";
  assertLocalDatabase(base);
  const u = new URL(base);
  u.pathname = "/postgres";
  const admin = postgres(u.toString(), { max: 1 });
  try {
    await admin.unsafe("DROP DATABASE IF EXISTS restaurant_test WITH (FORCE)");
    await admin.unsafe("CREATE DATABASE restaurant_test");
  } finally {
    await admin.end();
  }
  u.pathname = "/restaurant_test";
  process.env.TEST_DATABASE_URL = u.toString();

  // `syncRolePasswords: false` — обязательно. Роли в PostgreSQL живут в кластере, а не в
  // базе: `ALTER ROLE ... PASSWORD` из тестов перетирал бы рабочие пароли `n8n_app` и
  // `portal_app`, и приложения переставали бы подключаться (28P01). Тесты прав вместо
  // отдельного логина переключаются на роль через `SET LOCAL ROLE` — см. permissions.test.ts.
  await migrate(u.toString(), { syncRolePasswords: false });
}
