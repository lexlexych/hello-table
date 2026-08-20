import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyMigrations,
  dropProjectFunctions,
  rollbackLast,
  splitMigration,
} from "../../scripts/db/lib/apply.ts";
import { assertLocalDatabase } from "../../scripts/db/lib/config.ts";
import { migrate } from "../../scripts/db/migrate.ts";
import { testDatabaseUrl } from "./helpers/db.ts";

const MIGRATIONS = [
  "001_extensions.sql",
  "002_restaurants_and_tables.sql",
  "003_menu.sql",
  "004_operations.sql",
  "005_menu_nutrition.sql",
  "006_reservation_website_source.sql",
  "007_restaurant_voice_mode.sql",
  "008_callback_message_contacts.sql",
];

describe("migration runner safety", () => {
  it("splits every migration into reversible sections", async () => {
    for (const file of MIGRATIONS) {
      const parts = splitMigration(
        await readFile(`db/migrations/${file}`, "utf8"),
      );
      expect(parts.up.length).toBeGreaterThan(10);
      expect(parts.down.length).toBeGreaterThan(10);
    }
  });

  it("rejects a remote destructive target", () =>
    expect(() =>
      assertLocalDatabase("postgres://u:p@db.example/production"),
    ).toThrow(/non-local/));

  it("accepts localhost targets", () => {
    expect(() =>
      assertLocalDatabase("postgres://u:p@127.0.0.1:55432/restaurant"),
    ).not.toThrow();
  });
});

/**
 * Полный цикл раннера проверяется на ОТДЕЛЬНОЙ базе: откат сносит таблицы,
 * и делать это в общей тестовой базе нельзя — остальные файлы работают с ней.
 */
describe("полный цикл миграций на изолированной базе", () => {
  const scratchName = "restaurant_runner_test";
  let scratchUrl: string;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    const base = new URL(testDatabaseUrl());
    base.pathname = "/postgres";
    admin = postgres(base.toString(), { max: 1 });
    await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${scratchName}`);

    const target = new URL(testDatabaseUrl());
    target.pathname = `/${scratchName}`;
    scratchUrl = target.toString();
    sql = postgres(scratchUrl, { max: 2 });
  });

  afterAll(async () => {
    await sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
    await admin.end();
  });

  it("применяет все миграции на чистой базе", async () => {
    // syncRolePasswords: false — роли общие на кластер, тест не трогает пароли
    // рабочих ролей (см. db/README.md).
    await migrate(scratchUrl, { syncRolePasswords: false });
    const rows = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations ORDER BY version`;
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS);
  });

  it("повторный прогон ничего не применяет", async () => {
    const pending = await applyMigrations(sql, resolve("db/migrations"));
    expect(pending).toEqual([]);
  });

  it("ставит функции §5.2, дневную бронь портала и служебные роли", async () => {
    const functions = await sql<{ proname: string }[]>`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (
        'find_available_slots','create_reservation_atomic','cancel_reservation_by_phone',
        'find_menu_items','find_pickup_slots','create_pickup_order_atomic',
        'create_callback_request','delete_callback_request','purge_expired_personal_data',
        'book_table_for_day','cancel_table_booking')`;
    expect(functions).toHaveLength(11);

    const roles = await sql<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles WHERE rolname IN ('n8n_app','portal_app')`;
    expect(roles.map((r) => r.rolname).sort()).toEqual([
      "n8n_app",
      "portal_app",
    ]);
  });

  it("ловит правку уже применённой миграции по контрольной сумме", async () => {
    await sql`UPDATE schema_migrations SET checksum = 'tampered'
              WHERE version = ${"001_extensions.sql"}`;
    await expect(
      applyMigrations(sql, resolve("db/migrations")),
    ).rejects.toThrow(/changed after application/);
    // возвращаем настоящую сумму, чтобы не мешать следующим проверкам
    const text = await readFile("db/migrations/001_extensions.sql", "utf8");
    const { createHash } = await import("node:crypto");
    const checksum = createHash("sha256").update(text).digest("hex");
    await sql`UPDATE schema_migrations SET checksum = ${checksum}
              WHERE version = ${"001_extensions.sql"}`;
  });

  it("откатывает последнюю миграцию и применяет её заново", async () => {
    await dropProjectFunctions(sql);
    const rolled = await rollbackLast(sql, resolve("db/migrations"));
    expect(rolled).toBe("008_callback_message_contacts.sql");

    const [gone] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='callback_requests'
        AND column_name IN ('source', 'telegram_user_id')`;
    expect(gone?.n).toBe(0);

    const versions = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations ORDER BY version`;
    expect(versions.map((r) => r.version)).toEqual(MIGRATIONS.slice(0, -1));

    // и обратно: миграция накатывается повторно
    await migrate(scratchUrl, { syncRolePasswords: false });
    const [back] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='callback_requests'
        AND column_name IN ('source', 'telegram_user_id')`;
    expect(back?.n).toBe(2);
  });
});
