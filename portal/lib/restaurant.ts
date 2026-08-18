import type postgres from "postgres";
import { getConfig } from "./config";
import { db } from "./db";

/**
 * Ресторан, которым управляет этот экземпляр портала. Слаг задан конфигурацией
 * (`PORTAL_RESTAURANT_SLUG`), строка разрешается один раз на процесс: `restaurants`
 * не переименовывается на ходу, а лишний запрос на каждый рендер не нужен.
 *
 * Таймзона нужна экранам, которые работают с календарными днями: «сегодня» считается
 * по времени ресторана, а не по времени сервера (`portal/lib/day.ts`).
 */

export interface PortalRestaurant {
  id: string;
  timezone: string;
}

let cached: PortalRestaurant | undefined;

export async function getRestaurant(
  sql: postgres.Sql = db(),
): Promise<PortalRestaurant> {
  if (cached) {
    return cached;
  }

  const slug = getConfig().PORTAL_RESTAURANT_SLUG;
  const [row] = await sql<PortalRestaurant[]>`
    SELECT id, timezone FROM restaurants WHERE slug = ${slug} AND is_active`.catch(
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

  cached = row;
  return cached;
}

/** Подавляющему большинству вызывающих нужен только id. */
export async function getRestaurantId(
  sql: postgres.Sql = db(),
): Promise<string> {
  return (await getRestaurant(sql)).id;
}

/** Для тестов: сбрасывает запомненную строку, чтобы соседние наборы не мешали друг другу. */
export function resetRestaurantCache(): void {
  cached = undefined;
}
