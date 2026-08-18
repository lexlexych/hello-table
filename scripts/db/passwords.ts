import postgres from "postgres";
import { assertAppOwner, setRolePasswords } from "./lib/apply.ts";
import { resolveTarget, rolePasswords } from "./lib/config.ts";

/**
 * Возвращает ролям `n8n_app` и `portal_app` пароли из окружения.
 *
 * Зачем отдельная команда: роли в PostgreSQL живут в кластере, а не в базе. Прогон
 * `pnpm test` пересоздаёт базу `restaurant_test` в том же кластере и выставляет ролям
 * заведомо синтетические пароли (`db/tests/global-setup.ts`) — рабочие пароли из `.env`
 * при этом перетираются, и портал перестаёт подключаться с ошибкой 28P01.
 *
 * Схему команда не трогает, поэтому безопасна в любой момент.
 */
export async function syncRolePasswords(
  url = resolveTarget(process.argv.slice(2)).url,
): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await assertAppOwner(sql);
    await setRolePasswords(sql, rolePasswords());
    console.log("Role passwords synchronised from the environment");
  } finally {
    await sql.end();
  }
}

await syncRolePasswords();
