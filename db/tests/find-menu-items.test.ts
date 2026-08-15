import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";
import {
  addCategory,
  addMenuItem,
  createRestaurant,
  dropRestaurant,
} from "./helpers/fixtures.ts";

const sql = postgres(testDatabaseUrl(), { max: 8 });

let restaurantId: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "menu");
  const pizza = await addCategory(sql, restaurantId, "Pizza");
  const drinks = await addCategory(sql, restaurantId, "Getränke");

  await addMenuItem(sql, pizza, {
    nameDe: "Pizza Margherita",
    nameRu: "Пицца Маргарита",
    nameEn: "Margherita Pizza",
    descriptionDe: "Tomaten und Mozzarella",
    descriptionRu: "Томаты и моцарелла",
    priceCents: 950,
    aliases: ["margarita", "маргарита"],
    allergens: ["gluten", "milk"],
    isVegetarian: true,
  });
  await addMenuItem(sql, pizza, {
    nameDe: "Gemüsepfanne",
    nameRu: "Овощная сковорода",
    nameEn: "Vegetable pan",
    priceCents: 1150,
    allergens: ["celery"],
    isVegetarian: true,
    isVegan: true,
  });
  await addMenuItem(sql, pizza, {
    nameDe: "Calzone",
    nameRu: "Кальцоне",
    nameEn: "Calzone",
    priceCents: 1250,
    isAvailable: false, // недоступна — не должна возвращаться никогда
  });
  await addMenuItem(sql, drinks, {
    nameDe: "Apfelschorle",
    nameRu: "Яблочный шпритцер",
    nameEn: "Apple spritzer",
    priceCents: 350,
    isVegetarian: true,
    isVegan: true,
  });
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await sql.end();
});

interface MenuRow {
  item_name: string;
  item_description: string | null;
  item_price_cents: number;
  item_is_vegan: boolean;
  category_name: string;
  match_score: number;
}

function search(
  query: string | null,
  lang = "de",
  options: {
    veganOnly?: boolean;
    vegetarianOnly?: boolean;
    exclude?: string[] | null;
    limit?: number;
  } = {},
) {
  return sql<MenuRow[]>`SELECT * FROM find_menu_items(
    ${restaurantId}::uuid, ${query}::text, ${lang}::char(2),
    ${options.veganOnly ?? false}::bool, ${options.vegetarianOnly ?? false}::bool,
    ${options.exclude ?? null}::text[], ${options.limit ?? 10}::int)`;
}

describe("find_menu_items", () => {
  it("никогда не возвращает недоступные позиции", async () => {
    const all = await search(null, "de", { limit: 100 });
    expect(all.map((r) => r.item_name)).not.toContain("Calzone");
    const direct = await search("Calzone");
    expect(direct).toHaveLength(0);
  });

  it("пустой запрос отдаёт всё доступное меню", async () => {
    const all = await search(null, "de", { limit: 100 });
    expect(all).toHaveLength(3);
  });

  it("находит по названию", async () => {
    const rows = await search("Margherita");
    expect(rows[0]?.item_name).toBe("Pizza Margherita");
  });

  it("находит по алиасу", async () => {
    const rows = await search("margarita");
    expect(rows[0]?.item_name).toBe("Pizza Margherita");
  });

  it("находит по русскому алиасу при запросе на русском", async () => {
    const rows = await search("маргарита", "ru");
    expect(rows[0]?.item_name).toBe("Пицца Маргарита");
  });

  it("не зависит от регистра", async () => {
    const rows = await search("MARGHERITA");
    expect(rows[0]?.item_name).toBe("Pizza Margherita");
  });

  it("переживает опечатку за счёт триграмм", async () => {
    const rows = await search("Margarita Pizzza");
    expect(rows[0]?.item_name).toBe("Pizza Margherita");
  });

  it("снимает умляуты при поиске", async () => {
    const rows = await search("gemusepfanne");
    expect(rows[0]?.item_name).toBe("Gemüsepfanne");
  });

  it("отдаёт название и описание на языке запроса", async () => {
    const [de] = await search("Margherita", "de");
    const [ru] = await search("Маргарита", "ru");
    const [en] = await search("Margherita", "en");
    expect(de?.item_name).toBe("Pizza Margherita");
    expect(de?.item_description).toBe("Tomaten und Mozzarella");
    expect(ru?.item_name).toBe("Пицца Маргарита");
    expect(ru?.item_description).toBe("Томаты и моцарелла");
    expect(en?.item_name).toBe("Margherita Pizza");
  });

  it("фильтрует веганское (сценарий D из §1.2)", async () => {
    const rows = await search(null, "de", { veganOnly: true, limit: 100 });
    const names = rows.map((r) => r.item_name);
    expect(names).toContain("Gemüsepfanne");
    expect(names).toContain("Apfelschorle");
    expect(names).not.toContain("Pizza Margherita");
    for (const row of rows) expect(row.item_is_vegan).toBe(true);
  });

  it("исключает позиции с указанным аллергеном", async () => {
    const rows = await search(null, "de", {
      exclude: ["milk"],
      limit: 100,
    });
    expect(rows.map((r) => r.item_name)).not.toContain("Pizza Margherita");
  });

  it("возвращает название категории на языке запроса", async () => {
    const [row] = await search("Apfelschorle", "de");
    expect(row?.category_name).toBe("Getränke");
  });

  it("соблюдает limit", async () => {
    const rows = await search(null, "de", { limit: 1 });
    expect(rows).toHaveLength(1);
  });
});
