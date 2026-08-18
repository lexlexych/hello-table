import type postgres from "postgres";
import type { TableBookingInput, TableInput } from "./schemas/tables";

/**
 * Доступ к `restaurant_tables`. Соединение и id ресторана приходят параметрами —
 * так репозиторий тестируется против тестовой базы без конфигурации портала.
 *
 * Каждый запрос ограничен `restaurant_id`: id столика приходит из браузера, и без
 * этого условия администратор одного ресторана правил бы чужие столики.
 *
 * Справочник столиков портал правит прямым SQL, а брони — только через функции
 * Postgres (PROJECT.md §5.3): корректность и атомарность брони живут в базе.
 */

export interface RestaurantTable {
  id: string;
  label: string;
  seats: number;
  zone: string | null;
  isActive: boolean;
  combinable: boolean;
}

/** Столик вместе с его бронью на выбранный день; у свободного все поля брони пусты. */
export interface RestaurantTableForDay extends RestaurantTable {
  /** Местное время начала брони, `"18:30"`. */
  bookedFrom: string | null;
  bookedGuestName: string | null;
  bookedPartySize: number | null;
}

/**
 * Столики с бронью на календарный день ресторана. День сравнивается по местной дате
 * НАЧАЛА брони: бронь тянется до полуночи, и по концу диапазона она принадлежала бы
 * уже следующему дню.
 *
 * Время приходит уже отформатированным: пересчитывать часовой пояс в браузере
 * оператора незачем — таймзону ресторана знает база.
 */
export async function listTablesForDay(
  sql: postgres.Sql,
  restaurantId: string,
  date: string,
): Promise<RestaurantTableForDay[]> {
  // Сортировка как в зале: сначала по зоне (без зоны — в конец), потом по метке.
  return sql<RestaurantTableForDay[]>`
    SELECT t.id, t.label, t.seats, t.zone, t.is_active AS "isActive", t.combinable,
           b.from_time    AS "bookedFrom",
           b.guest_name   AS "bookedGuestName",
           b.party_size   AS "bookedPartySize"
    FROM restaurant_tables t
    JOIN restaurants r ON r.id = t.restaurant_id
    LEFT JOIN LATERAL (
      SELECT to_char(res.starts_at AT TIME ZONE r.timezone, 'HH24:MI') AS from_time,
             res.guest_name, res.party_size
      FROM reservations res
      WHERE res.table_id = t.id
        AND res.status IN ('confirmed', 'seated')
        AND (res.starts_at AT TIME ZONE r.timezone)::date = ${date}::date
      ORDER BY res.starts_at
      LIMIT 1
    ) b ON true
    WHERE t.restaurant_id = ${restaurantId}
    ORDER BY t.zone NULLS LAST, t.label`;
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

export interface TableBooking {
  reservationId: string;
  tableLabel: string;
  /** Местное время начала брони, `"18:30"`. */
  bookedFrom: string;
}

/**
 * Бронь столика на день. Все отказы — исключения с SQLSTATE из диапазона 45xxx
 * (`db/README.md`); маршрут превращает их в коды ответа.
 */
export async function bookTableForDay(
  sql: postgres.Sql,
  restaurantId: string,
  tableId: string,
  input: TableBookingInput,
): Promise<TableBooking> {
  // Функция вызывается в CTE, а таймзона дочитывается join-ом: сама функция отдаёт
  // момент времени, а экрану нужно местное настенное время.
  const [row] = await sql<TableBooking[]>`
    WITH booked AS (
      SELECT * FROM book_table_for_day(
        ${restaurantId}, ${tableId}, ${input.date}::date, ${input.time}::time,
        ${input.partySize}, ${input.guestName}, 'portal')
    )
    SELECT b.reservation_id AS "reservationId",
           b.booked_table_label AS "tableLabel",
           to_char(b.booked_starts_at AT TIME ZONE r.timezone, 'HH24:MI') AS "bookedFrom"
    FROM booked b
    JOIN restaurants r ON r.id = ${restaurantId}`;
  if (!row) {
    throw new Error("book_table_for_day не вернул строку");
  }
  return row;
}

/** `false` — брони на этот день не было; маршрут отдаст 404. */
export async function cancelTableBooking(
  sql: postgres.Sql,
  restaurantId: string,
  tableId: string,
  date: string,
): Promise<boolean> {
  const [row] = await sql<{ cancelled: number }[]>`
    SELECT cancel_table_booking(${restaurantId}, ${tableId}, ${date}::date) AS cancelled`;
  return (row?.cancelled ?? 0) > 0;
}
