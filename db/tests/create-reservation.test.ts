import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";
import {
  addTable,
  createRestaurant,
  dropRestaurant,
  futureAt,
  openAllWeek,
} from "./helpers/fixtures.ts";

const sql = postgres(testDatabaseUrl(), { max: 12 });

let restaurantId: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "resv");
  await openAllWeek(sql, restaurantId);
  await addTable(sql, restaurantId, "T1", 2);
  await addTable(sql, restaurantId, "T2", 4);
  await addTable(sql, restaurantId, "T8", 8);
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await sql.end();
});

function book(
  conn: postgres.Sql | postgres.ReservedSql,
  startsAt: Date,
  party = 2,
) {
  return conn`SELECT * FROM create_reservation_atomic(
    ${restaurantId}::uuid, ${startsAt}::timestamptz, ${party}::int,
    'Gast', '+493011122', 'de', 'test')`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("create_reservation_atomic", () => {
  it("возвращает метку столика и подтверждённое время", async () => {
    const slot = futureAt(2, 12);
    const [row] = await book(sql, slot, 2);
    expect(row).toBeDefined();
    expect(row?.assigned_table_label).toBe("T1"); // наименьший подходящий
    expect(new Date(row?.confirmed_starts_at).getTime()).toBe(slot.getTime());
    const end = new Date(row?.confirmed_ends_at);
    expect(end.getUTCHours()).toBe(0);
    expect(end.toISOString().slice(0, 10)).toBe(
      new Date(slot.getTime() + 24 * 60 * 60_000).toISOString().slice(0, 10),
    );
  });

  it("сажает компанию за наименьший подходящий столик", async () => {
    const [row] = await book(sql, futureAt(3, 12), 3);
    expect(row?.assigned_table_label).toBe("T2");
  });

  it("отдаёт party_too_large при компании больше max_party_size", async () => {
    await expect(book(sql, futureAt(4, 12), 99)).rejects.toMatchObject({
      code: "45005",
      message: "party_too_large",
    });
  });

  it("отдаёт slot_in_past для прошедшего времени", async () => {
    await expect(book(sql, futureAt(-1, 12), 2)).rejects.toMatchObject({
      code: "45006",
    });
  });

  it("отдаёт closed_at_requested_time вне часов работы", async () => {
    // часы 08:00–23:00 UTC, 03:00 закрыто
    await expect(book(sql, futureAt(5, 3), 2)).rejects.toMatchObject({
      code: "45004",
    });
  });

  it("отдаёт restaurant_not_found для чужого id", async () => {
    await expect(
      sql`SELECT * FROM create_reservation_atomic(
        ${"00000000-0000-0000-0000-000000000000"}::uuid,
        ${futureAt(6, 12)}::timestamptz, 2, 'Gast', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45000" });
  });

  it("заполняет delete_after датой визита плюс 30 дней", async () => {
    const slot = futureAt(7, 12);
    const [row] = await book(sql, slot, 2);
    const [saved] = await sql<{ delete_after: string }[]>`
      SELECT delete_after::text AS delete_after FROM reservations
      WHERE id = ${row?.reservation_id}`;
    const expected = new Date(slot);
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(saved?.delete_after).toBe(expected.toISOString().slice(0, 10));
  });

  it("уводит вторую бронь на другой столик, пока места есть", async () => {
    const slot = futureAt(8, 12);
    const [first] = await book(sql, slot, 2);
    const [second] = await book(sql, slot, 2);
    expect(first?.assigned_table_label).not.toBe(second?.assigned_table_label);
  });

  it("столик остаётся занят до конца дня и освобождается на следующий", async () => {
    // Ресторан с единственным столиком, чтобы альтернативы не было.
    const solo = await createRestaurant(sql, "buf");
    await openAllWeek(sql, solo);
    await addTable(sql, solo, "ONLY", 4);
    const base = futureAt(9, 12);
    await sql`SELECT * FROM create_reservation_atomic(${solo}::uuid, ${base}::timestamptz,
              2, 'A', '+49', 'de', 'test')`;
    const tooSoon = new Date(base.getTime() + 100 * 60_000);
    await expect(
      sql`SELECT * FROM create_reservation_atomic(${solo}::uuid, ${tooSoon}::timestamptz,
          2, 'B', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45001" });
    const late = new Date(base.getTime() + 150 * 60_000);
    await expect(
      sql`SELECT * FROM create_reservation_atomic(${solo}::uuid,
          ${late}::timestamptz, 2, 'C', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45001" });
    const nextDay = new Date(base.getTime() + 24 * 60 * 60_000);
    const [ok] = await sql`SELECT * FROM create_reservation_atomic(${solo}::uuid,
      ${nextDay}::timestamptz, 2, 'D', '+49', 'de', 'test')`;
    expect(ok?.reservation_id).toBeDefined();
    await dropRestaurant(sql, solo);
  });
});

describe("create_reservation_atomic: гонка (PROJECT.md §13)", () => {
  it("вторая транзакция ждёт на блокировке и получает no_table_available", async () => {
    // Ресторан с ЕДИНСТВЕННЫМ подходящим столиком: уйти некуда.
    const solo = await createRestaurant(sql, "race1");
    await openAllWeek(sql, solo);
    await addTable(sql, solo, "ONLY", 4);
    const slot = futureAt(10, 12);

    const a = await sql.reserve();
    const b = await sql.reserve();
    let bSettled = false;

    try {
      await a`BEGIN`;
      const [first] = await a`SELECT * FROM create_reservation_atomic(
        ${solo}::uuid, ${slot}::timestamptz, 2, 'A', '+49', 'de', 'test')`;
      expect(first?.reservation_id).toBeDefined();

      const bPromise = b`BEGIN`
        .then(
          () => b`SELECT * FROM create_reservation_atomic(
            ${solo}::uuid, ${slot}::timestamptz, 2, 'B', '+49', 'de', 'test')`,
        )
        .then(
          () => ({ ok: true }) as const,
          (error: { code?: string }) => ({ ok: false, error }) as const,
        )
        .finally(() => {
          bSettled = true;
        });

      await sleep(700);
      // Ключевая проверка: B не может завершиться, пока A держит блокировку столика.
      expect(bSettled).toBe(false);

      await a`COMMIT`;
      const result = await bPromise;
      await b`ROLLBACK`.catch(() => undefined);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.code).toBe("45001");
    } finally {
      await a.release();
      await b.release();
    }

    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations
      WHERE restaurant_id = ${solo} AND starts_at = ${slot} AND status = 'confirmed'`;
    expect(count?.n).toBe(1);
    await dropRestaurant(sql, solo);
  });

  it("из десяти параллельных броней проходит ровно одна", async () => {
    const solo = await createRestaurant(sql, "race2");
    await openAllWeek(sql, solo);
    await addTable(sql, solo, "ONLY", 4);
    const slot = futureAt(11, 12);

    const attempts = Array.from(
      { length: 10 },
      () => sql`SELECT * FROM create_reservation_atomic(
        ${solo}::uuid, ${slot}::timestamptz, 2, 'Gast', '+49', 'de', 'test')`,
    );
    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason.code).toBe("45001");
    }

    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations
      WHERE restaurant_id = ${solo} AND starts_at = ${slot} AND status = 'confirmed'`;
    expect(count?.n).toBe(1);
    await dropRestaurant(sql, solo);
  });

  it("ограничение EXCLUDE ловит вставку мимо функции", async () => {
    const solo = await createRestaurant(sql, "race3");
    await openAllWeek(sql, solo);
    const tableId = await addTable(sql, solo, "ONLY", 4);
    const start = futureAt(12, 12);
    const end = new Date(start.getTime() + 90 * 60_000);

    await sql`INSERT INTO reservations (restaurant_id, table_id, guest_name, party_size,
                starts_at, ends_at, source, language)
              VALUES (${solo}, ${tableId}, 'A', 2, ${start}, ${end}, 'portal', 'de')`;

    const overlap = new Date(start.getTime() + 30 * 60_000);
    const overlapEnd = new Date(overlap.getTime() + 90 * 60_000);
    await expect(
      sql`INSERT INTO reservations (restaurant_id, table_id, guest_name, party_size,
            starts_at, ends_at, source, language)
          VALUES (${solo}, ${tableId}, 'B', 2, ${overlap}, ${overlapEnd}, 'portal', 'de')`,
    ).rejects.toMatchObject({ code: "23P01" });

    await dropRestaurant(sql, solo);
  });
});
