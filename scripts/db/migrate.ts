import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  applyFunctions,
  applyMigrations,
  applyRoles,
  assertAppOwner,
  setRolePasswords,
} from "./lib/apply.ts";
import { resolveTarget, rolePasswords } from "./lib/config.ts";

export async function migrate(
  url = resolveTarget(process.argv.slice(2)).url,
): Promise<void> {
  const sql = postgres(url, { max: 1 });
  let locked = false;
  try {
    await assertAppOwner(sql);
    await sql`SELECT pg_advisory_lock(4711001)`;
    locked = true;
    const applied = await applyMigrations(sql, resolve("db/migrations"));
    await applyFunctions(sql, resolve("db/functions"));
    await applyRoles(sql, resolve("db/roles.sql"));
    await setRolePasswords(sql, rolePasswords());
    console.log(
      applied.length
        ? `Applied: ${applied.join(", ")}`
        : "No pending migrations",
    );
  } finally {
    if (locked)
      await sql`SELECT pg_advisory_unlock(4711001)`.catch(() => undefined);
    await sql.end();
  }
}

// pathToFileURL, а не `file://${argv[1]}`: на Windows argv[1] приходит как
// C:\path\to\file.ts, а import.meta.url — как file:///C:/path/to/file.ts,
// и наивное сравнение никогда не совпадает. Скрипт тогда молча выходит с кодом 0,
// не применив миграции.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await migrate();
}
