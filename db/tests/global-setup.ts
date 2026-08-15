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
  process.env.N8N_APP_PASSWORD = "n8n_app_test_1234";
  process.env.PORTAL_APP_PASSWORD = "portal_app_test_12";
  await migrate(u.toString());
}
