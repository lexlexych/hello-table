import { resolve } from "node:path";
import postgres from "postgres";
import {
  assertAppOwner,
  dropProjectFunctions,
  rollbackLast,
} from "./lib/apply.ts";
import { resolveTarget } from "./lib/config.ts";

const sql = postgres(resolveTarget(process.argv.slice(2)).url, { max: 1 });
let locked = false;
try {
  await assertAppOwner(sql);
  await sql`SELECT pg_advisory_lock(4711001)`;
  locked = true;
  await dropProjectFunctions(sql);
  const version = await rollbackLast(sql, resolve("db/migrations"));
  console.log(version ? `Rolled back: ${version}` : "Nothing to roll back");
} finally {
  if (locked)
    await sql`SELECT pg_advisory_unlock(4711001)`.catch(() => undefined);
  await sql.end();
}
