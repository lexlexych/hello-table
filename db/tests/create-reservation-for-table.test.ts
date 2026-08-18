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
 * Бронь конкретного столика по телефону — инструмент create_reservation.
 * Столик выбран гостем из ответа find_available_tables, поэтому функция его не
 * подбирает, а только проверяет и занимает.
 */

const TZ = "Europe/Berlin";
const sql = postgres(testDatabaseUrl(), { max: 12 });

let restaurantId: string;
let otherId: string;
let tableFour: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "res-table", { timezone: TZ });
  otherId = await createRestaurant(sql, "res-table-other", { timezone: TZ });
  await openAllWeek(sql, restaurantId, "12:00", "23:00");
  await openAllWeek(sql, otherId, "12:00", "23:00");
  tableFour = await addTable(sql, restaurantId, "R-4", 4, "Hauptraum");
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await dropRestaurant(sql, otherId);
  await sql.end();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function localDay(offset = 0): Promise<string> {
  const [row] = await sql<{ d: string }[]>`
    SELECT ((now() AT TIME ZONE ${TZ})::date + ${offset}::int)::text AS d`;
  return required(row, "местная дата").d;
}

interface Booked {
  reservation_id: string;
  booked_table_label: string;
  confirmed_starts_at: Date;
  confirmed_ends_at: Date;
}

function book(
  conn: postgres.Sql | postgres.ReservedSql,
  tableId: string,
  day: string,
  time: string,
  options: { restaurant?: string; party?: number; name?: string } = {},
) {
  return conn<Booked[]>`SELECT * FROM create_reservation_for_table(
    ${options.restaurant ?? restaurantId}::uuid, ${tableId}::uuid,
    ${day}::date, ${time}::time, ${options.party ?? 2}::int,
    ${options.name ?? "Gast"}, '+493012345678', 'de'::char(2), 'test')`;
}

describe("create_reservation_for_table", () => {
  it("бронирует именно тот столик, который назвали", async () => {
    const day = await localDay(30);
    const [row] = await book(sql, tableFour, day, "19:00", { name: "Anna" });

    expect(row?.booked_table_label).toBe("R-4");
    const [saved] = await sql<{ table_id: string; source: string }[]>`
      SELECT table_id, source FROM reservations WHERE id = ${required(row, "бронь").reservation_id}`;
    expect(saved?.table_id).toBe(tableFour);
    expect(saved?.source).toBe("test");
  });

  it("длительность брони равна slot_minutes ресторана", async () => {
    const day = await localDay(31);
    const [row] = await book(sql, tableFour, day, "19:00");
    const booked = required(row, "бронь");
    const minutes =
      (booked.confirmed_ends_at.getTime() -
        booked.confirmed_starts_at.getTime()) /
      60_000;
    expect(minutes).toBe(90);
  });

  it("время трактуется как местное для ресторана", async () => {
    const day = await localDay(32);
    const [row] = await book(sql, tableFour, day, "20:00");
    const [local] = await sql<{ w: string }[]>`
      SELECT (${required(row, "бронь").confirmed_starts_at}::timestamptz
              AT TIME ZONE ${TZ})::text AS w`;
    expect(local?.w).toContain("20:00:00");
  });

  it("занятый столик — table_already_booked (45016)", async () => {
    const day = await localDay(33);
    await book(sql, tableFour, day, "19:00");
    await expect(book(sql, tableFour, day, "19:30")).rejects.toMatchObject({
      code: "45016",
    });
  });

  it("буфер уборки тоже защищает столик", async () => {
    const day = await localDay(34);
    await book(sql, tableFour, day, "18:00");
    // Бронь 18:00–19:30, буфер 15 минут: попытка на 19:40 ещё пересекается.
    await expect(book(sql, tableFour, day, "19:40")).rejects.toMatchObject({
      code: "45016",
    });
  });

  it("столик с недостатком мест — table_not_available (45015)", async () => {
    const day = await localDay(35);
    await expect(
      book(sql, tableFour, day, "19:00", { party: 6 }),
    ).rejects.toMatchObject({ code: "45015" });
  });

  it("столик чужого ресторана — table_not_available (45015)", async () => {
    const day = await localDay(35);
    await expect(
      book(sql, tableFour, day, "19:00", { restaurant: otherId }),
    ).rejects.toMatchObject({ code: "45015" });
  });

  it("выключенный столик — table_not_available (45015)", async () => {
    const day = await localDay(35);
    const off = await addTable(sql, restaurantId, "R-off", 4);
    await sql`UPDATE restaurant_tables SET is_active = false WHERE id = ${off}`;
    await expect(book(sql, off, day, "19:00")).rejects.toMatchObject({
      code: "45015",
    });
  });

  it("компания больше max_party_size — party_too_large (45005)", async () => {
    const day = await localDay(35);
    await expect(
      book(sql, tableFour, day, "19:00", { party: 99 }),
    ).rejects.toMatchObject({ code: "45005" });
  });

  it("прошедшее время — slot_in_past (45006)", async () => {
    await expect(
      book(sql, tableFour, await localDay(-1), "19:00"),
    ).rejects.toMatchObject({ code: "45006" });
  });

  it("вне часов работы — closed_at_requested_time (45004)", async () => {
    await expect(
      book(sql, tableFour, await localDay(36), "03:00"),
    ).rejects.toMatchObject({ code: "45004" });
  });

  it("неизвестный ресторан — restaurant_not_found (45000)", async () => {
    await expect(
      book(sql, tableFour, await localDay(36), "19:00", {
        restaurant: "00000000-0000-0000-0000-0000000000ff",
      }),
    ).rejects.toMatchObject({ code: "45000" });
  });
});

describe("create_reservation_for_table: гонка (.claude/skills/db-migrations §4)", () => {
  it("вторая транзакция ждёт на блокировке столика и получает 45016", async () => {
    const tableId = await addTable(sql, restaurantId, "R-race-lock", 4);
    const day = await localDay(40);

    const a = await sql.reserve();
    const b = await sql.reserve();
    let bSettled = false;

    try {
      await a`BEGIN`;
      const [first] = await book(a, tableId, day, "18:00", { name: "A" });
      expect(first?.reservation_id).toBeDefined();

      const bPromise = b`BEGIN`
        .then(() => book(b, tableId, day, "18:30", { name: "B" }))
        .then(
          () => ({ ok: true }) as const,
          (error: { code?: string }) => ({ ok: false, error }) as const,
        )
        .finally(() => {
          bSettled = true;
        });

      await sleep(700);
      // Пока A держит блокировку строки столика, B не завершается.
      expect(bSettled).toBe(false);

      await a`COMMIT`;
      const result = await bPromise;
      await b`ROLLBACK`.catch(() => undefined);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error.code).toBe("45016");
    } finally {
      await a.release();
      await b.release();
    }

    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations
      WHERE table_id = ${tableId} AND status = 'confirmed'`;
    expect(count?.n).toBe(1);
  });

  it("из десяти параллельных броней одного столика на одно время проходит одна", async () => {
    const tableId = await addTable(sql, restaurantId, "R-race-many", 4);
    const day = await localDay(41);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        book(sql, tableId, day, "19:00", { name: `G${index}` }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const rejected of results.filter((r) => r.status === "rejected")) {
      expect((rejected as PromiseRejectedResult).reason.code).toBe("45016");
    }

    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations
      WHERE table_id = ${tableId} AND status = 'confirmed'`;
    expect(count?.n).toBe(1);
  });
});
