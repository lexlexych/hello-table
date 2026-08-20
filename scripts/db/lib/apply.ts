import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";

export function splitMigration(text: string): { up: string; down: string } {
  const upMarker = "-- migrate:up";
  const downMarker = "-- migrate:down";
  const upIndex = text.indexOf(upMarker);
  const downIndex = text.indexOf(downMarker);
  if (upIndex < 0 || downIndex < upIndex) {
    throw new Error("migration requires -- migrate:up and -- migrate:down");
  }
  return {
    up: text.slice(upIndex + upMarker.length, downIndex).trim(),
    down: text.slice(downIndex + downMarker.length).trim(),
  };
}

export async function assertAppOwner(sql: Sql): Promise<void> {
  const [identity] = await sql<
    { currentUser: string; databaseOwner: string }[]
  >`
    SELECT current_user AS "currentUser", pg_get_userbyid(datdba) AS "databaseOwner"
    FROM pg_database WHERE datname = current_database()
  `;
  if (
    identity?.currentUser !== "app_owner" ||
    identity?.databaseOwner !== "app_owner"
  ) {
    throw new Error(
      "migrations must connect as app_owner to a database owned by app_owner",
    );
  }
}

export async function ensureMigrationsTable(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
}

export async function appliedVersions(sql: Sql): Promise<Map<string, string>> {
  const rows = await sql<
    { version: string; checksum: string }[]
  >`SELECT version, checksum FROM schema_migrations`;
  return new Map(rows.map((row) => [row.version, row.checksum]));
}

async function migrationFiles(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort();
}

export async function applyMigrations(
  sql: Sql,
  dir: string,
  options: { dryRun?: boolean } = {},
): Promise<string[]> {
  await ensureMigrationsTable(sql);
  const done = await appliedVersions(sql);
  const result: string[] = [];
  for (const file of await migrationFiles(dir)) {
    const text = await readFile(join(dir, file), "utf8");
    const checksum = createHash("sha256").update(text).digest("hex");
    const oldChecksum = done.get(file);
    if (oldChecksum && oldChecksum !== checksum) {
      throw new Error(
        `migration ${file} changed after application; create a new migration or run pnpm db:reset`,
      );
    }
    if (oldChecksum) continue;
    if (!options.dryRun) {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(splitMigration(text).up).simple();
        await transaction`INSERT INTO schema_migrations(version, checksum) VALUES(${file}, ${checksum})`;
      });
    }
    result.push(file);
  }
  return result;
}

export async function rollbackLast(
  sql: Sql,
  dir: string,
): Promise<string | null> {
  await ensureMigrationsTable(sql);
  const [latest] = await sql<{ version: string }[]>`
    SELECT version FROM schema_migrations ORDER BY applied_at DESC, version DESC LIMIT 1
  `;
  if (!latest) return null;
  const text = await readFile(join(dir, latest.version), "utf8");
  await sql.begin(async (transaction) => {
    await transaction.unsafe(splitMigration(text).down).simple();
    await transaction`DELETE FROM schema_migrations WHERE version = ${latest.version}`;
  });
  return latest.version;
}

export async function applyFunctions(sql: Sql, dir: string): Promise<number> {
  const files = (await readdir(dir))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  await sql.begin(async (transaction) => {
    for (const file of files)
      await transaction
        .unsafe(await readFile(join(dir, file), "utf8"))
        .simple();
  });
  return files.length;
}

export async function dropProjectFunctions(sql: Sql): Promise<void> {
  await sql
    .unsafe(`DROP FUNCTION IF EXISTS
    find_available_slots(uuid,date,int,time,int), create_reservation_atomic(uuid,timestamptz,int,text,text,char,text),
    find_available_tables(uuid,date,time,int),
    create_reservation_for_table(uuid,uuid,date,time,int,text,text,char,text),
    cancel_reservation_by_phone(uuid,text,date), find_menu_items(uuid,text,char,bool,bool,text[],int),
    get_current_menu(uuid,char),
    find_pickup_slots(uuid,timestamptz,int,int), create_pickup_order_atomic(uuid,jsonb,timestamptz,text,text,char,text),
    find_pickup_slots_local(uuid,jsonb,date,time,int), create_pickup_order_local(uuid,jsonb,date,time,text,text,char,text),
    create_callback_request(uuid,text,char,text,text), delete_callback_request(uuid,uuid),
    purge_expired_personal_data(),
    book_table_for_day(uuid,uuid,date,time,int,text,text), cancel_table_booking(uuid,uuid,date),
    pickup_items_expand(jsonb), pickup_slot_is_free(uuid,timestamptz), is_open_between(uuid,timestamptz,timestamptz),
    opening_windows(uuid,date), app_normalize_phone(text), app_normalize_text(text),
    set_reservation_delete_after(), set_pickup_order_delete_after(), set_callback_delete_after() CASCADE`)
    .simple();
}

export async function applyRoles(sql: Sql, file: string): Promise<void> {
  await sql.unsafe(await readFile(file, "utf8")).simple();
}

export async function setRolePasswords(
  sql: Sql,
  passwords: {
    agentApp?: string | undefined;
    n8nApp?: string | undefined;
    portalApp?: string | undefined;
    websiteApp?: string | undefined;
  },
): Promise<void> {
  for (const [role, value] of [
    ["agent_app", passwords.agentApp],
    ["n8n_app", passwords.n8nApp],
    ["portal_app", passwords.portalApp],
    ["website_app", passwords.websiteApp],
  ] as const) {
    if (!value) {
      // Раньше здесь стоял ALTER ROLE ... NOLOGIN. Это разрушительное действие на весь
      // кластер из-за отсутствующей переменной окружения: одна забытая переменная гасила
      // вход роли во всех базах. Роль без пароля и так не пройдёт аутентификацию.
      console.warn(
        `Warning: ${role.toUpperCase()}_PASSWORD is unset; leaving ${role} password unchanged`,
      );
      continue;
    }
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(value))
      throw new Error(`${role} password must match [A-Za-z0-9_-]{16,128}`);
    await sql.unsafe(`ALTER ROLE ${role} LOGIN PASSWORD '${value}'`);
  }
}
