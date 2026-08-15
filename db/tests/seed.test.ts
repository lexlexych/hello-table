import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";

const sql = postgres(testDatabaseUrl(), { max: 4 });

async function applySeed(): Promise<void> {
  await sql.unsafe(await readFile("db/seed.sql", "utf8")).simple();
}

beforeAll(applySeed);
afterAll(() => sql.end());

describe("db/seed.sql", () => {
  it("создаёт демо-ресторан, доступный по slug", async () => {
    const [row] = await sql<
      { slug: string; timezone: string; ai_disclosure_de: string }[]
    >`SELECT slug, timezone, ai_disclosure_de FROM restaurants WHERE slug = 'demo'`;
    expect(row).toBeDefined();
    expect(row?.timezone).toBe("Europe/Berlin");
    expect(row?.ai_disclosure_de.trim().length).toBeGreaterThan(0);
  });

  it("наполняет столики, часы работы и меню", async () => {
    const [counts] = await sql<
      { tables: number; hours: number; categories: number; items: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM restaurant_tables t
           JOIN restaurants r ON r.id = t.restaurant_id WHERE r.slug='demo') AS tables,
        (SELECT count(*)::int FROM opening_hours h
           JOIN restaurants r ON r.id = h.restaurant_id WHERE r.slug='demo') AS hours,
        (SELECT count(*)::int FROM menu_categories c
           JOIN restaurants r ON r.id = c.restaurant_id WHERE r.slug='demo') AS categories,
        (SELECT count(*)::int FROM menu_items i
           JOIN menu_categories c ON c.id = i.category_id
           JOIN restaurants r ON r.id = c.restaurant_id WHERE r.slug='demo') AS items`;
    expect(counts?.tables).toBeGreaterThan(0);
    expect(counts?.hours).toBeGreaterThan(0);
    expect(counts?.categories).toBeGreaterThan(0);
    expect(counts?.items).toBeGreaterThan(0);
  });

  it("заполняет названия блюд на трёх языках", async () => {
    const rows = await sql<
      { name_de: string; name_ru: string; name_en: string }[]
    >`SELECT i.name_de, i.name_ru, i.name_en FROM menu_items i
      JOIN menu_categories c ON c.id = i.category_id
      JOIN restaurants r ON r.id = c.restaurant_id WHERE r.slug='demo'`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.name_de.trim()).not.toBe("");
      expect(row.name_ru.trim()).not.toBe("");
      expect(row.name_en.trim()).not.toBe("");
    }
    // хотя бы одно название действительно на кириллице — кодировка не поехала
    expect(rows.some((r) => /[А-Яа-яЁё]/.test(r.name_ru))).toBe(true);
  });

  it("не создаёт операционных данных", async () => {
    const [counts] = await sql<
      { reservations: number; orders: number; callbacks: number }[]
    >`
      SELECT
        (SELECT count(*)::int FROM reservations res
           JOIN restaurants r ON r.id = res.restaurant_id WHERE r.slug='demo') AS reservations,
        (SELECT count(*)::int FROM pickup_orders o
           JOIN restaurants r ON r.id = o.restaurant_id WHERE r.slug='demo') AS orders,
        (SELECT count(*)::int FROM callback_requests cb
           JOIN restaurants r ON r.id = cb.restaurant_id WHERE r.slug='demo') AS callbacks`;
    expect(counts?.reservations).toBe(0);
    expect(counts?.orders).toBe(0);
    expect(counts?.callbacks).toBe(0);
  });

  it("идемпотентен: повторное применение не плодит дублей", async () => {
    const before = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM menu_items i
      JOIN menu_categories c ON c.id = i.category_id
      JOIN restaurants r ON r.id = c.restaurant_id WHERE r.slug='demo'`;

    await applySeed();
    await applySeed();

    const after = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM menu_items i
      JOIN menu_categories c ON c.id = i.category_id
      JOIN restaurants r ON r.id = c.restaurant_id WHERE r.slug='demo'`;
    const [restaurants] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM restaurants WHERE slug='demo'`;

    expect(after[0]?.n).toBe(before[0]?.n);
    expect(restaurants?.n).toBe(1);
  });
});
