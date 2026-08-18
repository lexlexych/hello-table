import type postgres from "postgres";
import { getConfig } from "./config";
import { db } from "./db";

/**
 * Ресторан, которым управляет этот экземпляр портала. Слаг задан конфигурацией
 * (`PORTAL_RESTAURANT_SLUG`), id разрешается один раз на процесс: строка `restaurants`
 * не переименовывается на ходу, а лишний запрос на каждый рендер не нужен.
 */

let cached: string | undefined;

export async function getRestaurantId(
  sql: postgres.Sql = db(),
): Promise<string> {
  if (cached) {
    return cached;
  }

  const slug = getConfig().PORTAL_RESTAURANT_SLUG;
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM restaurants WHERE slug = ${slug} AND is_active`.catch(
    (error: unknown) => {
      // 28P01 означает, что пароль роли в базе разошёлся с `PORTAL_DATABASE_URL`.
      // Подсказка здесь потому, что сообщение Postgres само по себе не говорит, что делать.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "28P01"
      ) {
        throw new Error(
          "portal_app: база отвергла пароль (28P01). Пароль роли в базе разошёлся с " +
            "PORTAL_DATABASE_URL — синхронизируйте их командой `pnpm db:passwords`.",
          { cause: error },
        );
      }
      throw error;
    },
  );

  if (!row) {
    // Слаг в тексте ошибки — не секрет: он попадает и в .env.example, и в seed.
    throw new Error(
      `PORTAL_RESTAURANT_SLUG=${slug}: активного ресторана с таким слагом в базе нет`,
    );
  }

  cached = row.id;
  return cached;
}

/** Для тестов: сбрасывает запомненный id, чтобы соседние наборы не мешали друг другу. */
export function resetRestaurantCache(): void {
  cached = undefined;
}
