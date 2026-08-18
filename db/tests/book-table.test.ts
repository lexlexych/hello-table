import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { required, testDatabaseUrl } from "./helpers/db.ts";
import {
  addTable,
  createRestaurant,
  dropRestaurant,
} from "./helpers/fixtures.ts";

/**
 * Дневная бронь столика из портала. В отличие от create_reservation_atomic столик
 * задан снаружи, а бронь тянется от указанного времени до местной полуночи.
 *
 * Все даты считает сама база (`now() AT TIME ZONE ...`), а не JavaScript: иначе
 * тест зависел бы от таймзоны машины разработчика.
 */

const TZ = "Europe/Berlin";
const sql = postgres(testDatabaseUrl(), { max: 12 });

let restaurantId: string;
let otherId: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "book-day", { timezone: TZ });
  otherId = await createRestaurant(sql, "book-day-other", { timezone: TZ });
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await dropRestaurant(sql, otherId);
  await sql.end();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Местная дата ресторана со сдвигом в днях. */
async function localDay(offset = 0): Promise<string> {
  const [row] = await sql<{ d: string }[]>`
    SELECT ((now() AT TIME ZONE ${TZ})::date + ${offset}::int)::text AS d`;
  return required(row, "местная дата").d;
}

/** Местное настенное время метки — тоже через базу, без арифметики в JS. */
async function localWallClock(at: string): Promise<string> {
  const [row] = await sql<{ w: string }[]>`
    SELECT (${at}::timestamptz AT TIME ZONE ${TZ})::text AS w`;
  return required(row, "местное время").w;
}

function book(
  conn: postgres.Sql | postgres.ReservedSql,
  tableId: string,
  day: string,
  time: string,
  options: { restaurant?: string; party?: number; name?: string } = {},
) {
  return conn`SELECT * FROM book_table_for_day(
    ${options.restaurant ?? restaurantId}::uuid, ${tableId}::uuid,
    ${day}::date, ${time}::time, ${options.party ?? 2}::int,
    ${options.name ?? "Gast"}::text, 'portal')`;
}

function cancel(tableId: string, day: string, restaurant = restaurantId) {
  return sql<{ cancel_table_booking: number }[]>`
    SELECT cancel_table_booking(${restaurant}::uuid, ${tableId}::uuid, ${day}::date)`;
}

describe("book_table_for_day", () => {
  it("занимает столик с указанного времени до местной полуночи", async () => {
    const tableId = await addTable(sql, restaurantId, "B-midnight", 4);
    const day = await localDay(3);
    const nextDay = await localDay(4);

    const [row] = await book(sql, tableId, day, "18:30");
    expect(row?.booked_table_id).toBe(tableId);
    expect(row?.booked_table_label).toBe("B-midnight");
    expect(await localWallClock(row?.booked_starts_at)).toBe(`${day} 18:30:00`);
    expect(await localWallClock(row?.booked_ends_at)).toBe(
      `${nextDay} 00:00:00`,
    );
  });

  it("пишет бронь портала: confirmed, без телефона, на языке ресторана", async () => {
    const tableId = await addTable(sql, restaurantId, "B-row", 4);
    const day = await localDay(3);
    const [row] = await book(sql, tableId, day, "12:00", {
      party: 5,
      name: "Frau Meier",
    });

    const [saved] = await sql<
      {
        guest_name: string;
        guest_phone: string | null;
        party_size: number;
        status: string;
        source: string;
        language: string;
        delete_after: Date | null;
      }[]
    >`SELECT guest_name, guest_phone, party_size, status, source, language, delete_after
      FROM reservations WHERE id = ${row?.reservation_id}`;

    expect(saved).toMatchObject({
      guest_name: "Frau Meier",
      guest_phone: null,
      party_size: 5,
      status: "confirmed",
      source: "portal",
      language: "de",
    });
    // delete_after ставит триггер: дата визита + 30 дней (PROJECT.md §5.1).
    expect(saved?.delete_after).not.toBeNull();
  });

  it("не применяет max_party_size: столик выбрал человек", async () => {
    // max_party_size по умолчанию 8 — телефонную бронь на 12 человек функция агента
    // отвергла бы кодом 45005.
    const tableId = await addTable(sql, restaurantId, "B-large", 12);
    const [row] = await book(sql, tableId, await localDay(3), "19:00", {
      party: 12,
    });
    expect(row?.reservation_id).toBeDefined();
  });

  it("разрешает бронь на сегодня с уже прошедшим временем", async () => {
    const tableId = await addTable(sql, restaurantId, "B-today", 2);
    const [row] = await book(sql, tableId, await localDay(0), "00:00");
    expect(row?.reservation_id).toBeDefined();
  });

  it("отвергает прошедший день", async () => {
    const tableId = await addTable(sql, restaurantId, "B-past", 2);
    await expect(
      book(sql, tableId, await localDay(-1), "12:00"),
    ).rejects.toMatchObject({ code: "45006" });
  });

  it("отвергает выключенный, чужой и несуществующий столик", async () => {
    const day = await localDay(3);

    const off = await addTable(sql, restaurantId, "B-off", 2);
    await sql`UPDATE restaurant_tables SET is_active = false WHERE id = ${off}`;
    await expect(book(sql, off, day, "12:00")).rejects.toMatchObject({
      code: "45015",
    });

    const mine = await addTable(sql, restaurantId, "B-foreign", 2);
    await expect(
      book(sql, mine, day, "12:00", { restaurant: otherId }),
    ).rejects.toMatchObject({ code: "45015" });

    await expect(
      book(sql, "00000000-0000-0000-0000-000000000000", day, "12:00"),
    ).rejects.toMatchObject({ code: "45015" });
  });

  it("отвергает неизвестный ресторан", async () => {
    const tableId = await addTable(sql, restaurantId, "B-nores", 2);
    await expect(
      book(sql, tableId, await localDay(3), "12:00", {
        restaurant: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "45000" });
  });

  it("не даёт вторую бронь в тот же день — даже на более раннее время", async () => {
    const tableId = await addTable(sql, restaurantId, "B-twice", 4);
    const day = await localDay(5);
    await book(sql, tableId, day, "20:00");

    await expect(book(sql, tableId, day, "20:00")).rejects.toMatchObject({
      code: "45016",
    });
    // Первая бронь тянется до полуночи, поэтому пересекается и с более ранней.
    await expect(book(sql, tableId, day, "10:00")).rejects.toMatchObject({
      code: "45016",
    });
  });

  it("пускает тот же столик на следующий день: границы диапазона полуоткрыты", async () => {
    const tableId = await addTable(sql, restaurantId, "B-nextday", 4);
    await book(sql, tableId, await localDay(6), "19:00");

    const [row] = await book(sql, tableId, await localDay(7), "00:00");
    expect(row?.reservation_id).toBeDefined();
  });

  it("считается с телефонной бронью того же столика", async () => {
    const tableId = await addTable(sql, restaurantId, "B-phone", 4);
    const day = await localDay(8);
    const [row] = await sql<{ starts_at: string }[]>`
      SELECT ((${day}::date + time '19:00') AT TIME ZONE ${TZ}) AS starts_at`;
    const starts = required(row, "начало телефонной брони").starts_at;

    await sql`INSERT INTO reservations (restaurant_id, table_id, guest_name, party_size,
                starts_at, ends_at, source, language)
              VALUES (${restaurantId}, ${tableId}, 'Phone', 2, ${starts},
                      ${starts}::timestamptz + interval '90 minutes', 'phone', 'de')`;

    await expect(book(sql, tableId, day, "18:00")).rejects.toMatchObject({
      code: "45016",
    });
  });
});

describe("cancel_table_booking", () => {
  it("снимает бронь, второй раз возвращает ноль и освобождает день", async () => {
    const tableId = await addTable(sql, restaurantId, "B-cancel", 4);
    const day = await localDay(9);
    await book(sql, tableId, day, "17:00");

    const [first] = await cancel(tableId, day);
    expect(first?.cancel_table_booking).toBe(1);

    const [second] = await cancel(tableId, day);
    expect(second?.cancel_table_booking).toBe(0);

    // Столик снова свободен: снятая бронь имеет статус cancelled и не пересекается.
    const [again] = await book(sql, tableId, day, "21:00");
    expect(again?.reservation_id).toBeDefined();
  });

  it("не трогает бронь соседнего дня и чужого ресторана", async () => {
    const tableId = await addTable(sql, restaurantId, "B-cancel-scope", 4);
    const day = await localDay(10);
    await book(sql, tableId, day, "17:00");

    const [otherDay] = await cancel(tableId, await localDay(11));
    expect(otherDay?.cancel_table_booking).toBe(0);

    const [foreign] = await cancel(tableId, day, otherId);
    expect(foreign?.cancel_table_booking).toBe(0);

    const [still] = await cancel(tableId, day);
    expect(still?.cancel_table_booking).toBe(1);
  });

  it("отвергает неизвестный ресторан", async () => {
    const tableId = await addTable(sql, restaurantId, "B-cancel-nores", 2);
    await expect(
      cancel(
        tableId,
        await localDay(3),
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toMatchObject({ code: "45000" });
  });
});

describe("book_table_for_day: гонка (.claude/skills/db-migrations §4)", () => {
  it("вторая транзакция ждёт на блокировке столика и получает table_already_booked", async () => {
    const tableId = await addTable(sql, restaurantId, "B-race-lock", 4);
    const day = await localDay(20);

    const a = await sql.reserve();
    const b = await sql.reserve();
    let bSettled = false;

    try {
      await a`BEGIN`;
      const [first] = await book(a, tableId, day, "18:00", { name: "A" });
      expect(first?.reservation_id).toBeDefined();

      const bPromise = b`BEGIN`
        .then(() => book(b, tableId, day, "19:00", { name: "B" }))
        .then(
          () => ({ ok: true }) as const,
          (error: { code?: string }) => ({ ok: false, error }) as const,
        )
        .finally(() => {
          bSettled = true;
        });

      await sleep(700);
      // Ключевая проверка: пока A держит блокировку строки столика, B не завершается.
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

  it("из десяти параллельных броней одного столика проходит ровно одна", async () => {
    const tableId = await addTable(sql, restaurantId, "B-race-many", 4);
    const day = await localDay(21);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        book(sql, tableId, day, `${10 + index}:00`),
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
