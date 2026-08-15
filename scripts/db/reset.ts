import postgres from "postgres";
import { assertLocalDatabase, resolveTarget } from "./lib/config.ts";
import { migrate } from "./migrate.ts";

const target = resolveTarget(process.argv.slice(2));
assertLocalDatabase(target.url);
if (!process.argv.includes("--yes") && process.env.DB_RESET_CONFIRM !== "1")
  throw new Error(
    `Refusing to drop ${target.database}; pass --yes or DB_RESET_CONFIRM=1`,
  );
if (!/^[A-Za-z0-9_]+$/.test(target.database) || target.database === "postgres")
  throw new Error("unsafe database name");
const u = new URL(target.url);
u.pathname = "/postgres";
const sql = postgres(u.toString(), { max: 1 });
try {
  await sql.unsafe(`DROP DATABASE IF EXISTS "${target.database}" WITH (FORCE)`);
  await sql.unsafe(`CREATE DATABASE "${target.database}"`);
} finally {
  await sql.end();
}
await migrate(target.url);
