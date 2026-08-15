import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";

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
  it("requires all AI disclosures", async () => {
    await expect(
      sql`INSERT INTO restaurants(name,slug,ai_disclosure_de,ai_disclosure_ru,ai_disclosure_en) VALUES('x','xx','','ru','en')`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
