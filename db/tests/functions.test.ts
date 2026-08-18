import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";

const sql = postgres(testDatabaseUrl());
afterAll(() => sql.end());
describe("database functions", () => {
  it("installs every public RPC function", async () => {
    const rows = await sql<
      { proname: string }[]
    >`SELECT DISTINCT proname FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='public'`;
    const names = rows.map((r) => r.proname);
    for (const name of [
      "find_available_slots",
      "create_reservation_atomic",
      "cancel_reservation_by_phone",
      "find_menu_items",
      "find_pickup_slots",
      "create_pickup_order_atomic",
      "create_callback_request",
      "purge_expired_personal_data",
      "book_table_for_day",
      "cancel_table_booking",
      "find_available_tables",
      "create_reservation_for_table",
    ])
      expect(names).toContain(name);
  });
});
