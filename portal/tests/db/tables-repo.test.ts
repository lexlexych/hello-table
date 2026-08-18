import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTable,
  deleteTable,
  listTables,
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
  openAllWeek,
} from "../../../db/tests/helpers/fixtures";

/**
 * Репозиторий столиков против настоящего Postgres. Проверяется то, чего не видно
 * на моках: изоляция по ресторану и поведение внешних ключей.
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

    const list = await listTables(sql, restaurantId);
    expect(list.map((row) => row.id)).toContain(created.id);

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

      expect((await listTables(sql, local)).map((row) => row.label)).toEqual([
        "C",
        "A",
        "B",
      ]);
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
      const [row] = await listTables(sql, restaurantId).then((rows) =>
        rows.filter((table) => table.id === mine.id),
      );
      expect(row?.seats).toBe(4);
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
    expect(
      (await listTables(sql, otherId)).some((row) => row.label === "R-fixture"),
    ).toBe(true);
  });
});
