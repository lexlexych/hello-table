import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";

/**
 * Машинная проверка PROJECT.md §3.5 и §5.3: у роли n8n_app нет прав на таблицы,
 * есть только EXECUTE на функции §5.2; portal_app читает и пишет, но не удаляет.
 */

function connectAs(role: string, password: string) {
  const url = new URL(testDatabaseUrl());
  url.username = role;
  url.password = password;
  return postgres(url.toString(), { max: 2 });
}

const asN8n = connectAs("n8n_app", "n8n_app_test_1234");
const asPortal = connectAs("portal_app", "portal_app_test_12");
const asOwner = postgres(testDatabaseUrl(), { max: 2 });

afterAll(async () => {
  await Promise.all([asN8n.end(), asPortal.end(), asOwner.end()]);
});

const TABLES = [
  "restaurants",
  "restaurant_tables",
  "reservations",
  "pickup_orders",
  "menu_items",
  "callback_requests",
  "call_logs",
];

describe("роль n8n_app (§3.5)", () => {
  for (const table of TABLES) {
    it(`не может прочитать ${table}`, async () => {
      await expect(
        asN8n.unsafe(`SELECT * FROM ${table} LIMIT 1`),
      ).rejects.toMatchObject({ code: "42501" });
    });
  }

  it("не может писать в таблицы напрямую", async () => {
    await expect(
      asN8n`INSERT INTO call_logs (restaurant_id, room_name)
            VALUES ('00000000-0000-0000-0000-000000000000', 'x')`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("может выполнять функции инструментов", async () => {
    // Ресторана нет — ожидаем доменную ошибку 45000, а НЕ отказ в правах 42501.
    await expect(
      asN8n`SELECT * FROM find_available_slots(
        '00000000-0000-0000-0000-000000000000'::uuid, current_date, 2, NULL, 5)`,
    ).rejects.toMatchObject({ code: "45000" });

    await expect(
      asN8n`SELECT create_callback_request(
        '00000000-0000-0000-0000-000000000000'::uuid, '+49', 'de', 'x', 'other')`,
    ).rejects.toMatchObject({ code: "45000" });
  });

  it("не может вызвать purge_expired_personal_data", async () => {
    await expect(
      asN8n`SELECT purge_expired_personal_data()`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("не может вызвать внутренние вспомогательные функции", async () => {
    await expect(
      asN8n`SELECT * FROM opening_windows(
        '00000000-0000-0000-0000-000000000000'::uuid, current_date)`,
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("роль portal_app (§5.3)", () => {
  it("читает таблицы", async () => {
    const rows = await asPortal`SELECT count(*)::int AS n FROM restaurants`;
    expect(rows[0]?.n).toBeGreaterThanOrEqual(0);
  });

  it("не может удалять строки", async () => {
    await expect(
      asPortal`DELETE FROM reservations WHERE false`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("не имеет доступа к служебной таблице миграций", async () => {
    await expect(
      asPortal`SELECT * FROM schema_migrations LIMIT 1`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("может выполнять функции броней", async () => {
    await expect(
      asPortal`SELECT * FROM find_available_slots(
        '00000000-0000-0000-0000-000000000000'::uuid, current_date, 2, NULL, 5)`,
    ).rejects.toMatchObject({ code: "45000" });
  });
});

describe("владелец схемы", () => {
  it("функции §5.2 объявлены SECURITY DEFINER и принадлежат app_owner", async () => {
    const rows = await asOwner<
      {
        proname: string;
        prosecdef: boolean;
        owner: string;
        config: string[] | null;
      }[]
    >`
      SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN (
        'find_available_slots','create_reservation_atomic','cancel_reservation_by_phone',
        'find_menu_items','find_pickup_slots','create_pickup_order_atomic',
        'create_callback_request','purge_expired_personal_data')`;

    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.owner).toBe("app_owner");
      // SECURITY DEFINER без фиксированного search_path небезопасен
      expect(row.config?.join(",")).toMatch(/search_path=/);
    }
  });
});
