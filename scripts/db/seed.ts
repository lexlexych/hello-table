import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { resolveTarget } from "./lib/config.ts";

const sql = postgres(resolveTarget(process.argv.slice(2)).url, { max: 1 });
try {
  await sql.unsafe(await readFile("db/seed.sql", "utf8")).simple();
  console.log("Seed applied");
} finally {
  await sql.end();
}
