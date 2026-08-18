import type postgres from "postgres";
import type { TableInput } from "./schemas/tables";

/**
 * Доступ к `restaurant_tables`. Соединение и id ресторана приходят параметрами —
 * так репозиторий тестируется против тестовой базы без конфигурации портала.
 *
 * Каждый запрос ограничен `restaurant_id`: id столика приходит из браузера, и без
 * этого условия администратор одного ресторана правил бы чужие столики.
 */

export interface RestaurantTable {
  id: string;
  label: string;
  seats: number;
  zone: string | null;
  isActive: boolean;
  combinable: boolean;
}

export async function listTables(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<RestaurantTable[]> {
  // Сортировка как в зале: сначала по зоне (без зоны — в конец), потом по метке.
  return sql<RestaurantTable[]>`
    SELECT id, label, seats, zone, is_active AS "isActive", combinable
    FROM restaurant_tables
    WHERE restaurant_id = ${restaurantId}
    ORDER BY zone NULLS LAST, label`;
}

export async function createTable(
  sql: postgres.Sql,
  restaurantId: string,
  input: TableInput,
): Promise<RestaurantTable> {
  const [row] = await sql<RestaurantTable[]>`
    INSERT INTO restaurant_tables (restaurant_id, label, seats, zone, is_active, combinable)
    VALUES (${restaurantId}, ${input.label}, ${input.seats}, ${input.zone},
            ${input.isActive}, ${input.combinable})
    RETURNING id, label, seats, zone, is_active AS "isActive", combinable`;
  if (!row) {
    throw new Error("INSERT в restaurant_tables не вернул строку");
  }
  return row;
}

/** `undefined` означает «такого столика в этом ресторане нет» — маршрут отдаст 404. */
export async function updateTable(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
  input: TableInput,
): Promise<RestaurantTable | undefined> {
  const [row] = await sql<RestaurantTable[]>`
    UPDATE restaurant_tables
    SET label = ${input.label}, seats = ${input.seats}, zone = ${input.zone},
        is_active = ${input.isActive}, combinable = ${input.combinable}
    WHERE id = ${id} AND restaurant_id = ${restaurantId}
    RETURNING id, label, seats, zone, is_active AS "isActive", combinable`;
  return row;
}

/** `false` — столика не было. Отказ из-за брони прилетает исключением 23503. */
export async function deleteTable(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM restaurant_tables
    WHERE id = ${id} AND restaurant_id = ${restaurantId}
    RETURNING id`;
  return rows.length > 0;
}
