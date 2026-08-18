import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";
import {
  addCategory,
  createRestaurant,
  dropRestaurant,
} from "./helpers/fixtures.ts";

const sql = postgres(testDatabaseUrl());
afterAll(() => sql.end());
describe("schema", () => {
  it("contains all eleven domain tables", async () => {
    const rows = await sql<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
    const names = rows.map((r) => r.table_name);
    for (const name of [
      "restaurants",
      "restaurant_tables",
      "opening_hours",
      "special_closures",
      "menu_categories",
      "menu_items",
      "reservations",
      "pickup_orders",
      "pickup_order_items",
      "callback_requests",
      "call_logs",
    ])
      expect(names).toContain(name);
  });
  it("хранит порцию и пищевую ценность блюда (миграция 005)", async () => {
    const rows = await sql<
      { column_name: string; is_nullable: string }[]
    >`SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='menu_items'`;
    const nullable = new Map(rows.map((r) => [r.column_name, r.is_nullable]));
    for (const name of [
      "weight_g",
      "volume_ml",
      "kcal",
      "protein_g",
      "fat_g",
      "carbs_g",
    ]) {
      // Все шесть обязаны быть nullable: у напитков нет веса, у части блюд нет КБЖУ,
      // и подставлять туда нули вместо «неизвестно» нельзя.
      expect(nullable.get(name)).toBe("YES");
    }
  });
  it("не принимает отрицательную пищевую ценность", async () => {
    const restaurantId = await createRestaurant(sql, "schema-kcal");
    const categoryId = await addCategory(sql, restaurantId, "Nährwerte");
    try {
      await expect(
        sql`INSERT INTO menu_items(category_id,name_de,name_ru,name_en,price_cents,kcal)
            VALUES(${categoryId},'x','x','x',100,-1)`,
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await dropRestaurant(sql, restaurantId);
    }
  });
  it("requires all AI disclosures", async () => {
    await expect(
      sql`INSERT INTO restaurants(name,slug,ai_disclosure_de,ai_disclosure_ru,ai_disclosure_en) VALUES('x','xx','','ru','en')`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
