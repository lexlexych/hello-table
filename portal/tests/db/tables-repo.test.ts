import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bookTableForDay,
  cancelTableBooking,
  createTable,
  deleteTable,
  listTablesForDay,
  type RestaurantTableForDay,
  updateTable,
} from "@/lib/tables";
// Без расширения `.ts`: файл проверяется конфигурацией портала
// (`moduleResolution: bundler`), где явное расширение запрещено.
import { testDatabaseUrl } from "../../../db/tests/helpers/db";
import {
  addTable,
  createRestaurant,
  dropRestaurant,
  futureAt,
  isoDate,
  openAllWeek,
} from "../../../db/tests/helpers/fixtures";

/**
 * Репозиторий столиков против настоящего Postgres. Проверяется то, чего не видно
 * на моках: изоляция по ресторану, поведение внешних ключей и брони на день.
 *
 * Фикстура ресторана живёт в таймзоне UTC, поэтому календарный день ресторана
 * совпадает с датой в ISO-строке — арифметику часовых поясов проверяет
 * `db/tests/book-table.test.ts` на ресторане в Europe/Berlin.
 */

const sql = postgres(testDatabaseUrl(), { max: 2 });

let restaurantId: string;
let otherId: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "tables-repo");
  otherId = await createRestaurant(sql, "tables-repo-other");
  await openAllWeek(sql, restaurantId);
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await dropRestaurant(sql, otherId);
  await sql.end();
});

const INPUT = {
  label: "R1",
  seats: 4,
  zone: "Terrasse",
  isActive: true,
  combinable: false,
};

/** День со сдвигом вперёд — тот же, что видит база в таймзоне UTC. */
function day(daysAhead: number): string {
  return isoDate(futureAt(daysAhead, 12));
}

async function findRow(
  restaurant: string,
  date: string,
  id: string,
): Promise<RestaurantTableForDay | undefined> {
  const rows = await listTablesForDay(sql, restaurant, date);
  return rows.find((row) => row.id === id);
}

describe("репозиторий столиков", () => {
  it("создаёт, читает и меняет столик", async () => {
    const created = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-crud",
    });
    expect(created).toMatchObject({
      label: "R-crud",
      seats: 4,
      isActive: true,
    });

    const updated = await updateTable(sql, restaurantId, created.id, {
      ...INPUT,
      label: "R-crud",
      seats: 6,
      zone: null,
      isActive: false,
    });
    expect(updated).toMatchObject({ seats: 6, zone: null, isActive: false });

    expect(await findRow(restaurantId, day(1), created.id)).toBeDefined();

    expect(await deleteTable(sql, restaurantId, created.id)).toBe(true);
    expect(await deleteTable(sql, restaurantId, created.id)).toBe(false);
  });

  it("сортирует по зоне, а столики без зоны ставит в конец", async () => {
    const local = await createRestaurant(sql, "tables-sort");
    try {
      await createTable(sql, local, { ...INPUT, label: "B", zone: null });
      await createTable(sql, local, { ...INPUT, label: "A", zone: "Terrasse" });
      await createTable(sql, local, {
        ...INPUT,
        label: "C",
        zone: "Hauptraum",
      });

      const rows = await listTablesForDay(sql, local, day(1));
      expect(rows.map((row) => row.label)).toEqual(["C", "A", "B"]);
    } finally {
      await dropRestaurant(sql, local);
    }
  });

  it("не даёт править и удалять столик чужого ресторана", async () => {
    const mine = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-own",
    });
    try {
      expect(
        await updateTable(sql, otherId, mine.id, { ...INPUT, seats: 2 }),
      ).toBeUndefined();
      expect(await deleteTable(sql, otherId, mine.id)).toBe(false);

      // Столик остался нетронутым.
      expect((await findRow(restaurantId, day(1), mine.id))?.seats).toBe(4);
    } finally {
      await deleteTable(sql, restaurantId, mine.id);
    }
  });

  it("не пускает повтор метки внутри ресторана, но пускает в другом", async () => {
    const first = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-dup",
    });
    try {
      await expect(
        createTable(sql, restaurantId, { ...INPUT, label: "R-dup" }),
      ).rejects.toMatchObject({ code: "23505" });

      const elsewhere = await createTable(sql, otherId, {
        ...INPUT,
        label: "R-dup",
      });
      await deleteTable(sql, otherId, elsewhere.id);
    } finally {
      await deleteTable(sql, restaurantId, first.id);
    }
  });

  it("не отдаёт удалить столик с бронью — только выключить", async () => {
    const table = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-booked",
    });
    const starts = futureAt(3, 12);
    await sql`
      INSERT INTO reservations (restaurant_id, table_id, guest_name, party_size,
                                starts_at, ends_at, source, language)
      VALUES (${restaurantId}, ${table.id}, 'Fixture', 2, ${starts},
              ${new Date(starts.getTime() + 90 * 60_000)}, 'test', 'de')`;

    // 23001 restrict_violation — именно так Postgres отвечает на ON DELETE RESTRICT.
    await expect(
      deleteTable(sql, restaurantId, table.id),
    ).rejects.toMatchObject({ code: "23001" });

    const off = await updateTable(sql, restaurantId, table.id, {
      ...INPUT,
      label: "R-booked",
      isActive: false,
    });
    expect(off?.isActive).toBe(false);
  });

  it("оставляет seed-фикстуры соседних тестов в покое", async () => {
    // Фикстура addTable кладёт столик мимо репозитория — репозиторий обязан его видеть.
    await addTable(sql, otherId, "R-fixture", 2);
    const rows = await listTablesForDay(sql, otherId, day(1));
    expect(rows.some((row) => row.label === "R-fixture")).toBe(true);
  });
});

describe("дневная бронь столика", () => {
  it("бронирует столик и показывает бронь в списке этого дня", async () => {
    const table = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-book",
    });
    const date = day(4);

    const booking = await bookTableForDay(sql, restaurantId, table.id, {
      date,
      time: "18:30",
      guestName: "Frau Meier",
      partySize: 3,
    });
    expect(booking).toMatchObject({
      tableLabel: "R-book",
      bookedFrom: "18:30",
    });

    expect(await findRow(restaurantId, date, table.id)).toMatchObject({
      bookedFrom: "18:30",
      bookedGuestName: "Frau Meier",
      bookedPartySize: 3,
    });
  });

  it("не показывает бронь в соседние дни", async () => {
    const table = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-book-day",
    });
    const date = day(5);
    await bookTableForDay(sql, restaurantId, table.id, {
      date,
      time: "12:00",
      guestName: "Gast",
      partySize: 2,
    });

    for (const other of [day(4), day(6)]) {
      expect(await findRow(restaurantId, other, table.id)).toMatchObject({
        bookedFrom: null,
        bookedGuestName: null,
        bookedPartySize: null,
      });
    }
  });

  it("снимает бронь и освобождает день", async () => {
    const table = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-book-cancel",
    });
    const date = day(7);
    await bookTableForDay(sql, restaurantId, table.id, {
      date,
      time: "17:00",
      guestName: "Gast",
      partySize: 2,
    });

    expect(await cancelTableBooking(sql, restaurantId, table.id, date)).toBe(
      true,
    );
    // Повторное снятие — уже нечего снимать: маршрут превратит это в 404.
    expect(await cancelTableBooking(sql, restaurantId, table.id, date)).toBe(
      false,
    );
    expect((await findRow(restaurantId, date, table.id))?.bookedFrom).toBe(
      null,
    );

    // Освободившийся день бронируется снова.
    await bookTableForDay(sql, restaurantId, table.id, {
      date,
      time: "21:00",
      guestName: "Gast",
      partySize: 2,
    });
    expect((await findRow(restaurantId, date, table.id))?.bookedFrom).toBe(
      "21:00",
    );
  });

  it("не бронирует и не снимает бронь через чужой ресторан", async () => {
    const table = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-book-foreign",
    });
    const date = day(8);

    await expect(
      bookTableForDay(sql, otherId, table.id, {
        date,
        time: "18:00",
        guestName: "Gast",
        partySize: 2,
      }),
    ).rejects.toMatchObject({ code: "45015" });

    await bookTableForDay(sql, restaurantId, table.id, {
      date,
      time: "18:00",
      guestName: "Gast",
      partySize: 2,
    });
    expect(await cancelTableBooking(sql, otherId, table.id, date)).toBe(false);
    expect((await findRow(restaurantId, date, table.id))?.bookedFrom).toBe(
      "18:00",
    );
  });

  it("отвергает вторую бронь того же столика в тот же день", async () => {
    const table = await createTable(sql, restaurantId, {
      ...INPUT,
      label: "R-book-twice",
    });
    const date = day(9);
    const input = {
      date,
      time: "19:00",
      guestName: "Gast",
      partySize: 2,
    };

    await bookTableForDay(sql, restaurantId, table.id, input);
    await expect(
      bookTableForDay(sql, restaurantId, table.id, input),
    ).rejects.toMatchObject({ code: "45016" });
  });
});
