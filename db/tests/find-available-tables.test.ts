import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { required, testDatabaseUrl } from "./helpers/db.ts";
import {
  addTable,
  createRestaurant,
  dropRestaurant,
  openAllWeek,
} from "./helpers/fixtures.ts";

/**
 * Свободные столики на конкретное время — вход инструмента check_availability.
 * Главное отличие от find_available_slots, ради которого функция и появилась:
 * отдаются ВСЕ подходящие столики и вместе с зоной, чтобы агент мог спросить
 * «зал или терраса».
 *
 * Все даты считает база (`now() AT TIME ZONE ...`), а не JavaScript: иначе тест
 * зависел бы от таймзоны машины разработчика.
 */

const TZ = "Europe/Berlin";
const sql = postgres(testDatabaseUrl(), { max: 6 });

let restaurantId: string;
let hallSmall: string;
let hallLarge: string;
let terrace: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "find-tables", { timezone: TZ });
  await openAllWeek(sql, restaurantId, "12:00", "23:00");
  hallSmall = await addTable(sql, restaurantId, "H-2", 2, "Hauptraum");
  hallLarge = await addTable(sql, restaurantId, "H-4", 4, "Hauptraum");
  terrace = await addTable(sql, restaurantId, "T-4", 4, "Terrasse");
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await sql.end();
});

/** Местная дата ресторана со сдвигом в днях. */
async function localDay(offset = 0): Promise<string> {
  const [row] = await sql<{ d: string }[]>`
    SELECT ((now() AT TIME ZONE ${TZ})::date + ${offset}::int)::text AS d`;
  return required(row, "местная дата").d;
}

interface Found {
  table_id: string;
  table_label: string;
  table_seats: number;
  table_zone: string | null;
}

function find(day: string, time: string, party: number, restaurant?: string) {
  return sql<Found[]>`SELECT * FROM find_available_tables(
    ${restaurant ?? restaurantId}::uuid, ${day}::date, ${time}::time, ${party}::int)`;
}

describe("find_available_tables", () => {
  it("отдаёт все подходящие столики обеих зон, а не один самый маленький", async () => {
    const rows = await find(await localDay(3), "19:00", 4);
    const ids = rows.map((row) => row.table_id);

    expect(ids).toContain(hallLarge);
    expect(ids).toContain(terrace);
    // Двухместный столик компании из четверых не подходит.
    expect(ids).not.toContain(hallSmall);
    expect(new Set(rows.map((row) => row.table_zone))).toEqual(
      new Set(["Hauptraum", "Terrasse"]),
    );
  });

  it("возвращает зону вместе со столиком", async () => {
    const rows = await find(await localDay(3), "19:00", 2);
    const small = rows.find((row) => row.table_id === hallSmall);
    expect(small?.table_zone).toBe("Hauptraum");
    expect(small?.table_seats).toBe(2);
  });

  it("сортирует от самого компактного подходящего столика", async () => {
    const rows = await find(await localDay(3), "19:00", 2);
    expect(rows[0]?.table_seats).toBe(2);
  });

  it("не показывает занятый столик и учитывает буфер уборки", async () => {
    const day = await localDay(4);
    await sql`SELECT * FROM create_reservation_for_table(
      ${restaurantId}::uuid, ${terrace}::uuid, ${day}::date, '19:00'::time,
      4::int, 'Belegt', NULL, 'de'::char(2), 'test')`;

    const atSame = await find(day, "19:00", 4);
    expect(atSame.map((row) => row.table_id)).not.toContain(terrace);

    // Бронь 19:00–20:30 плюс буфер 15 минут с каждой стороны: 20:30 ещё занято.
    const atBuffer = await find(day, "20:30", 4);
    expect(atBuffer.map((row) => row.table_id)).not.toContain(terrace);

    // Через 15 минут после конца буфера столик снова свободен. Позже 21:30 брать
    // нельзя: слот длиной 90 минут уже не помещается до закрытия в 23:00.
    const later = await find(day, "21:00", 4);
    expect(later.map((row) => row.table_id)).toContain(terrace);
  });

  it("отменённая бронь столик не занимает", async () => {
    const day = await localDay(5);
    const [row] = await sql<{ reservation_id: string }[]>`
      SELECT * FROM create_reservation_for_table(
        ${restaurantId}::uuid, ${hallLarge}::uuid, ${day}::date, '18:00'::time,
        4::int, 'Storno', NULL, 'de'::char(2), 'test')`;
    await sql`UPDATE reservations SET status = 'cancelled'
              WHERE id = ${required(row, "бронь").reservation_id}`;

    const rows = await find(day, "18:00", 4);
    expect(rows.map((r) => r.table_id)).toContain(hallLarge);
  });

  it("вне часов работы возвращает пусто, а не ошибку", async () => {
    const rows = await find(await localDay(3), "03:00", 2);
    expect(rows).toHaveLength(0);
  });

  it("в день особого закрытия возвращает пусто", async () => {
    const day = await localDay(6);
    await sql`INSERT INTO special_closures (restaurant_id, date, reason)
              VALUES (${restaurantId}, ${day}, 'Betriebsfeier')`;
    const rows = await find(day, "19:00", 2);
    expect(rows).toHaveLength(0);
  });

  it("прошедшее время возвращает пусто", async () => {
    const rows = await find(await localDay(-1), "19:00", 2);
    expect(rows).toHaveLength(0);
  });

  it("компания больше max_party_size — это пусто, а не ошибка", async () => {
    const rows = await find(await localDay(3), "19:00", 99);
    expect(rows).toHaveLength(0);
  });

  it("неизвестный ресторан — ошибка 45000", async () => {
    await expect(
      find(
        await localDay(3),
        "19:00",
        2,
        "00000000-0000-0000-0000-0000000000ff",
      ),
    ).rejects.toMatchObject({ code: "45000" });
  });
});
