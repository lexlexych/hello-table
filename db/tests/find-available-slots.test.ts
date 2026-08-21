import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { required, testDatabaseUrl } from "./helpers/db.ts";
import {
  addTable,
  createRestaurant,
  dropRestaurant,
  futureAt,
  isoDate,
  openAllWeek,
} from "./helpers/fixtures.ts";

const sql = postgres(testDatabaseUrl(), { max: 8 });

let restaurantId: string;
const created: string[] = [];

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "slots");
  created.push(restaurantId);
  await openAllWeek(sql, restaurantId);
  await addTable(sql, restaurantId, "T2", 2);
  await addTable(sql, restaurantId, "T4", 4);
  await addTable(sql, restaurantId, "T8", 8);
});

afterAll(async () => {
  for (const id of created) await dropRestaurant(sql, id);
  await sql.end();
});

function slots(
  id: string,
  date: Date,
  party: number,
  preferred?: string,
  limit = 10,
) {
  return sql<
    { slot_time: Date; slot_table_label: string; slot_seats: number }[]
  >`SELECT * FROM find_available_slots(
      ${id}::uuid, ${isoDate(date)}::date, ${party}::int,
      ${preferred ?? null}::time, ${limit}::int)`;
}

describe("find_available_slots", () => {
  it("возвращает слоты по сетке booking_step_minutes", async () => {
    const rows = await slots(restaurantId, futureAt(3, 12), 2);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.slot_time.getTime() % (15 * 60_000)).toBe(0);
    }
  });

  it("на каждое время предлагает наименьший подходящий столик", async () => {
    const rows = await slots(restaurantId, futureAt(3, 12), 3);
    for (const row of rows) expect(row.slot_seats).toBe(4);
  });

  it("не выдаёт прошедшие слоты", async () => {
    const rows = await slots(restaurantId, new Date(), 2, undefined, 50);
    for (const row of rows) {
      expect(row.slot_time.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("пусто в закрытый день", async () => {
    const closed = await createRestaurant(sql, "closed");
    created.push(closed);
    await addTable(sql, closed, "T", 4);
    await sql`INSERT INTO opening_hours (restaurant_id, weekday, is_closed)
              SELECT ${closed}, g, true FROM generate_series(0,6) g`;
    expect(await slots(closed, futureAt(3, 12), 2)).toHaveLength(0);
  });

  it("пусто в день особого закрытия", async () => {
    const date = futureAt(4, 12);
    const before = await slots(restaurantId, date, 2);
    expect(before.length).toBeGreaterThan(0);

    await sql`INSERT INTO special_closures (restaurant_id, date, reason)
              VALUES (${restaurantId}, ${isoDate(date)}, 'Feiertag')`;
    expect(await slots(restaurantId, date, 2)).toHaveLength(0);
    await sql`DELETE FROM special_closures WHERE restaurant_id = ${restaurantId}
              AND date = ${isoDate(date)}`;
  });

  it("пусто для компании больше max_party_size", async () => {
    expect(await slots(restaurantId, futureAt(3, 12), 99)).toHaveLength(0);
  });

  it("сортирует по близости к желаемому времени", async () => {
    const rows = await slots(restaurantId, futureAt(5, 12), 2, "19:00", 5);
    expect(rows.length).toBeGreaterThan(1);
    const target = new Date(futureAt(5, 12));
    target.setUTCHours(19, 0, 0, 0);
    const distances = rows.map((r) =>
      Math.abs(r.slot_time.getTime() - target.getTime()),
    );
    const sorted = [...distances].sort((a, b) => a - b);
    expect(distances).toEqual(sorted);
  });

  it("поддерживает два окна в один день: обед и ужин", async () => {
    const split = await createRestaurant(sql, "split");
    created.push(split);
    await addTable(sql, split, "T", 4);
    for (let weekday = 0; weekday < 7; weekday += 1) {
      await sql`INSERT INTO opening_hours (restaurant_id, weekday, opens, closes)
                VALUES (${split}, ${weekday}, '11:00', '14:00')`;
      await sql`INSERT INTO opening_hours (restaurant_id, weekday, opens, closes)
                VALUES (${split}, ${weekday}, '18:00', '23:00')`;
    }
    // slot_minutes = 90, значит окно 11:00–14:00 даёт слоты до 12:30
    const rows = await slots(split, futureAt(3, 12), 2, undefined, 100);
    const hours = new Set(rows.map((r) => r.slot_time.getUTCHours()));
    expect([...hours].some((h) => h >= 11 && h <= 12)).toBe(true);
    expect([...hours].some((h) => h >= 18)).toBe(true);
    // между окнами слотов быть не должно
    expect([...hours]).not.toContain(15);
    expect([...hours]).not.toContain(16);
  });

  it("после бронирования столик исключается до конца дня", async () => {
    const solo = await createRestaurant(sql, "busy");
    created.push(solo);
    await openAllWeek(sql, solo);
    await addTable(sql, solo, "ONLY", 4);
    const date = futureAt(6, 12);
    const before = await slots(solo, date, 2, undefined, 100);
    expect(before.length).toBeGreaterThan(0);

    const booked = before[0]?.slot_time as Date;
    await sql`SELECT * FROM create_reservation_atomic(${solo}::uuid,
              ${booked}::timestamptz, 2, 'A', '+49', 'de', 'test')`;

    const after = await slots(solo, date, 2, undefined, 100);
    expect(after).toHaveLength(0);
  });

  it("отдаёт restaurant_not_found для неактивного ресторана", async () => {
    const off = await createRestaurant(sql, "off", { isActive: false });
    created.push(off);
    await expect(slots(off, futureAt(3, 12), 2)).rejects.toMatchObject({
      code: "45000",
    });
  });
});

describe("find_available_slots: часовые пояса (PROJECT.md §13)", () => {
  it("держит локальное время открытия по обе стороны перехода на зимнее время", async () => {
    // Европа/Берлин переходит на зимнее время в ночь на 25.10.2026:
    // до перехода UTC+2 (CEST), после — UTC+1 (CET).
    const berlin = await createRestaurant(sql, "tz", {
      timezone: "Europe/Berlin",
    });
    created.push(berlin);
    await openAllWeek(sql, berlin, "08:00", "23:00");
    await addTable(sql, berlin, "T", 4);

    const [cest] = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_available_slots(${berlin}::uuid, '2026-10-24'::date, 2, NULL, 1)`;
    const [cet] = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_available_slots(${berlin}::uuid, '2026-10-26'::date, 2, NULL, 1)`;

    const cestSlot = required(cest?.slot_time, "слот до перехода");
    const cetSlot = required(cet?.slot_time, "слот после перехода");

    // Оба первых слота — 08:00 по Берлину, но в UTC это разные часы.
    expect(cestSlot.toISOString()).toBe("2026-10-24T06:00:00.000Z");
    expect(cetSlot.toISOString()).toBe("2026-10-26T07:00:00.000Z");

    // И оба рендерятся как 08:00 локально — это то, что услышит гость.
    const [local] = await sql<{ a: string; b: string }[]>`
      SELECT to_char(${cestSlot}::timestamptz AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS a,
             to_char(${cetSlot}::timestamptz  AT TIME ZONE 'Europe/Berlin', 'HH24:MI') AS b`;
    expect(local?.a).toBe("08:00");
    expect(local?.b).toBe("08:00");
  });
});
