import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";
import {
  addCategory,
  addMenuItem,
  createRestaurant,
  dropRestaurant,
  futureAt,
  openAllWeek,
} from "./helpers/fixtures.ts";

const sql = postgres(testDatabaseUrl(), { max: 12 });

let restaurantId: string;
let pizzaId: string;
let saladId: string;
let soldOutId: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "pick", { pickupSlotCapacity: 4 });
  await openAllWeek(sql, restaurantId);
  const category = await addCategory(sql, restaurantId, "Pizza");
  pizzaId = await addMenuItem(sql, category, {
    nameDe: "Margherita",
    nameRu: "Маргарита",
    nameEn: "Margherita",
    priceCents: 950,
    prepMinutes: 20,
  });
  saladId = await addMenuItem(sql, category, {
    nameDe: "Caesar",
    nameRu: "Цезарь",
    nameEn: "Caesar",
    priceCents: 750,
    prepMinutes: 10,
  });
  soldOutId = await addMenuItem(sql, category, {
    nameDe: "Calzone",
    nameRu: "Кальцоне",
    nameEn: "Calzone",
    priceCents: 1100,
    isAvailable: false,
  });
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await sql.end();
});

/** jsonb передаём через sql.json: обычная строка уедет как JSON-строка, не массив. */
function items(
  list: Array<{ menu_item_id: string; quantity: number; note?: string }>,
) {
  return sql.json(list);
}

describe("find_pickup_slots", () => {
  it("выдаёт слоты по сетке 15 минут и не раньше лид-тайма", async () => {
    const rows = await sql<{ slot_time: Date; free_capacity: number }[]>`
      SELECT * FROM find_pickup_slots(${restaurantId}::uuid, NULL, 0, 6)`;
    expect(rows.length).toBeGreaterThan(0);
    const lead = Date.now() + 30 * 60_000; // pickup_lead_minutes по умолчанию
    for (const row of rows) {
      expect(row.slot_time.getTime()).toBeGreaterThanOrEqual(lead - 60_000);
      expect(row.slot_time.getTime() % (15 * 60_000)).toBe(0);
      expect(row.free_capacity).toBe(4);
    }
  });

  it("учитывает prep_minutes блюда сверх лид-тайма", async () => {
    const [withoutPrep] = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_pickup_slots(${restaurantId}::uuid, NULL, 0, 1)`;
    const [withPrep] = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_pickup_slots(${restaurantId}::uuid, NULL, 120, 1)`;
    expect(withPrep?.slot_time.getTime()).toBeGreaterThan(
      Number(withoutPrep?.slot_time.getTime()),
    );
  });

  it("не выдаёт слоты вне часов работы", async () => {
    const night = await createRestaurant(sql, "night");
    // окно всего два часа в сутки
    await openAllWeek(sql, night, "10:00", "12:00");
    const rows = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_pickup_slots(${night}::uuid, NULL, 0, 50)`;
    for (const row of rows) {
      const hour = row.slot_time.getUTCHours();
      expect(hour).toBeGreaterThanOrEqual(10);
      expect(hour).toBeLessThan(12);
    }
    await dropRestaurant(sql, night);
  });
});

describe("create_pickup_order_atomic", () => {
  it("считает сумму базой и выдаёт номер из четырёх цифр", async () => {
    const [row] = await sql`SELECT * FROM create_pickup_order_atomic(
      ${restaurantId}::uuid,
      ${items([
        { menu_item_id: pizzaId, quantity: 2 },
        { menu_item_id: saladId, quantity: 1 },
      ])},
      NULL, 'Gast', '+493011122', 'de', 'test')`;
    expect(row?.order_total_cents).toBe(2 * 950 + 750);
    expect(String(row?.assigned_order_number)).toMatch(/^[0-9]{4}$/);
    expect(row?.confirmed_ready_at).toBeInstanceOf(Date);

    const lines = await sql<{ quantity: number; unit_price_cents: number }[]>`
      SELECT quantity, unit_price_cents FROM pickup_order_items
      WHERE order_id = ${row?.pickup_order_id} ORDER BY unit_price_cents`;
    expect(lines).toHaveLength(2);
    // цена зафиксирована на момент заказа
    expect(lines.map((l) => l.unit_price_cents).sort((a, b) => a - b)).toEqual([
      750, 950,
    ]);
  });

  it("отдаёт item_unavailable для недоступной позиции", async () => {
    await expect(
      sql`SELECT * FROM create_pickup_order_atomic(${restaurantId}::uuid,
          ${items([{ menu_item_id: soldOutId, quantity: 1 }])},
          NULL, 'Gast', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45003" });
  });

  it("отдаёт item_unavailable для позиции чужого ресторана", async () => {
    const other = await createRestaurant(sql, "other");
    const cat = await addCategory(sql, other, "Pizza");
    const foreign = await addMenuItem(sql, cat, {
      nameDe: "Fremd",
      nameRu: "Чужое",
      nameEn: "Foreign",
    });
    await expect(
      sql`SELECT * FROM create_pickup_order_atomic(${restaurantId}::uuid,
          ${items([{ menu_item_id: foreign, quantity: 1 }])},
          NULL, 'Gast', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45003" });
    await dropRestaurant(sql, other);
  });

  it("отдаёт empty_order на пустой корзине", async () => {
    await expect(
      sql`SELECT * FROM create_pickup_order_atomic(${restaurantId}::uuid,
          ${items([])}, NULL, 'Gast', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45007" });
  });

  it("отдаёт pickup_too_early для времени раньше лид-тайма", async () => {
    const tooSoon = new Date(Date.now() + 5 * 60_000);
    await expect(
      sql`SELECT * FROM create_pickup_order_atomic(${restaurantId}::uuid,
          ${items([{ menu_item_id: saladId, quantity: 1 }])},
          ${tooSoon}::timestamptz, 'Gast', '+49', 'de', 'test')`,
    ).rejects.toMatchObject({ code: "45010" });
  });

  it("заполняет delete_after датой выдачи плюс 30 дней", async () => {
    const [row] = await sql`SELECT * FROM create_pickup_order_atomic(
      ${restaurantId}::uuid, ${items([{ menu_item_id: saladId, quantity: 1 }])},
      NULL, 'Gast', '+49', 'de', 'test')`;
    const [saved] = await sql<{ delete_after: string; ready_at: Date }[]>`
      SELECT delete_after::text AS delete_after, ready_at FROM pickup_orders
      WHERE id = ${row?.pickup_order_id}`;
    const expected = new Date(saved?.ready_at as Date);
    expected.setUTCDate(expected.getUTCDate() + 30);
    expect(saved?.delete_after).toBe(expected.toISOString().slice(0, 10));
  });
});

describe("create_pickup_order_atomic: гонка (PROJECT.md §13)", () => {
  it("при вместимости 1 из двух параллельных заказов проходит один", async () => {
    const solo = await createRestaurant(sql, "prace", {
      pickupSlotCapacity: 1,
    });
    await openAllWeek(sql, solo);
    const cat = await addCategory(sql, solo, "Pizza");
    const item = await addMenuItem(sql, cat, {
      nameDe: "M",
      nameRu: "М",
      nameEn: "M",
      priceCents: 950,
    });
    const slot = futureAt(1, 12);
    const payload = sql.json([{ menu_item_id: item, quantity: 2 }]);

    const results = await Promise.allSettled([
      sql`SELECT * FROM create_pickup_order_atomic(${solo}::uuid, ${payload},
          ${slot}::timestamptz, 'A', '+49', 'de', 'test')`,
      sql`SELECT * FROM create_pickup_order_atomic(${solo}::uuid, ${payload},
          ${slot}::timestamptz, 'B', '+49', 'de', 'test')`,
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("45002");

    const [count] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pickup_orders
      WHERE restaurant_id = ${solo} AND ready_at = ${slot}`;
    expect(count?.n).toBe(1);
    await dropRestaurant(sql, solo);
  });

  it("занятый слот исчезает из find_pickup_slots", async () => {
    const solo = await createRestaurant(sql, "pfull", {
      pickupSlotCapacity: 1,
    });
    await openAllWeek(sql, solo);
    const cat = await addCategory(sql, solo, "Pizza");
    const item = await addMenuItem(sql, cat, {
      nameDe: "M",
      nameRu: "М",
      nameEn: "M",
    });

    const [first] = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_pickup_slots(${solo}::uuid, NULL, 0, 1)`;
    const taken = first?.slot_time as Date;

    await sql`SELECT * FROM create_pickup_order_atomic(${solo}::uuid,
      ${sql.json([{ menu_item_id: item, quantity: 1 }])},
      ${taken}::timestamptz, 'A', '+49', 'de', 'test')`;

    const after = await sql<{ slot_time: Date }[]>`
      SELECT * FROM find_pickup_slots(${solo}::uuid, NULL, 0, 5)`;
    expect(after.map((r) => r.slot_time.getTime())).not.toContain(
      taken.getTime(),
    );
    await dropRestaurant(sql, solo);
  });
});
