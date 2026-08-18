import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./helpers/db.ts";
import { createRestaurant, dropRestaurant } from "./helpers/fixtures.ts";

/**
 * Машинная проверка PROJECT.md §3.5 и §5.3: у роли n8n_app нет прав на таблицы,
 * есть только EXECUTE на функции §5.2; portal_app читает и пишет, удаляет строки
 * справочников (портал редактирует столики и меню), но не операционные таблицы
 * с персональными данными.
 *
 * Роль переключается через `SET LOCAL ROLE`, а не отдельным логином с паролем.
 * Это принципиально: роли в PostgreSQL живут в кластере, а не в базе, поэтому
 * `ALTER ROLE ... PASSWORD` из тестов перетирал бы рабочие пароли в базе разработчика
 * и ломал вход портала (28P01). Проверяются права, а не механизм аутентификации,
 * и для прав `SET ROLE` полностью эквивалентен отдельному соединению.
 */

const sql = postgres(testDatabaseUrl(), { max: 4 });

afterAll(async () => {
  await sql.end();
});

/**
 * Выполняет запросы от имени роли в отдельной транзакции. `SET LOCAL` откатывается
 * вместе с ней, поэтому соседние проверки не наследуют чужую роль.
 */
function asRole<T>(
  role: "n8n_app" | "portal_app",
  body: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    return body(tx);
  }) as Promise<T>;
}

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
        asRole("n8n_app", (tx) => tx.unsafe(`SELECT * FROM ${table} LIMIT 1`)),
      ).rejects.toMatchObject({ code: "42501" });
    });
  }

  it("не может писать в таблицы напрямую", async () => {
    await expect(
      asRole(
        "n8n_app",
        (tx) => tx`INSERT INTO call_logs (restaurant_id, room_name)
                   VALUES ('00000000-0000-0000-0000-000000000000', 'x')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("может выполнять функции инструментов", async () => {
    // Ресторана нет — ожидаем доменную ошибку 45000, а НЕ отказ в правах 42501.
    await expect(
      asRole(
        "n8n_app",
        (tx) => tx`SELECT * FROM find_available_slots(
          '00000000-0000-0000-0000-000000000000'::uuid, current_date, 2, NULL, 5)`,
      ),
    ).rejects.toMatchObject({ code: "45000" });

    await expect(
      asRole(
        "n8n_app",
        (tx) => tx`SELECT create_callback_request(
          '00000000-0000-0000-0000-000000000000'::uuid, '+49', 'de', 'x', 'other')`,
      ),
    ).rejects.toMatchObject({ code: "45000" });
  });

  it("не может вызвать функции дневной брони портала", async () => {
    for (const call of [
      "SELECT * FROM book_table_for_day('00000000-0000-0000-0000-000000000000'::uuid," +
        " '00000000-0000-0000-0000-000000000000'::uuid, current_date, time '12:00', 2, 'x', 'portal')",
      "SELECT cancel_table_booking('00000000-0000-0000-0000-000000000000'::uuid," +
        " '00000000-0000-0000-0000-000000000000'::uuid, current_date)",
    ]) {
      await expect(
        asRole("n8n_app", (tx) => tx.unsafe(call)),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("не может вызвать purge_expired_personal_data", async () => {
    await expect(
      asRole("n8n_app", (tx) => tx`SELECT purge_expired_personal_data()`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("не может вызвать внутренние вспомогательные функции", async () => {
    await expect(
      asRole(
        "n8n_app",
        (tx) => tx`SELECT * FROM opening_windows(
          '00000000-0000-0000-0000-000000000000'::uuid, current_date)`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("роль portal_app (§5.3)", () => {
  it("читает таблицы", async () => {
    const rows = await asRole(
      "portal_app",
      (tx) => tx`SELECT count(*)::int AS n FROM restaurants`,
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(0);
  });

  it("не может удалять строки операционных таблиц", async () => {
    for (const table of [
      "reservations",
      "pickup_orders",
      "callback_requests",
      "call_logs",
    ]) {
      await expect(
        asRole("portal_app", (tx) =>
          tx.unsafe(`DELETE FROM ${table} WHERE false`),
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("удаляет строки справочников, которыми управляет портал", async () => {
    const restaurantId = await createRestaurant(sql, "perm");
    try {
      await asRole("portal_app", async (tx) => {
        const [table] = await tx<{ id: string }[]>`
          INSERT INTO restaurant_tables (restaurant_id, label, seats)
          VALUES (${restaurantId}, 'P1', 2) RETURNING id`;
        const [category] = await tx<{ id: string }[]>`
          INSERT INTO menu_categories (restaurant_id, name_de, name_ru, name_en)
          VALUES (${restaurantId}, 'Vorspeisen', 'Закуски', 'Starters') RETURNING id`;
        const [item] = await tx<{ id: string }[]>`
          INSERT INTO menu_items (category_id, name_de, name_ru, name_en, price_cents)
          VALUES (${category?.id ?? null}, 'Suppe', 'Суп', 'Soup', 500) RETURNING id`;

        // Порядок обратный ссылкам: menu_items → menu_categories (ON DELETE RESTRICT).
        expect(
          (await tx`DELETE FROM menu_items WHERE id = ${item?.id ?? null}`)
            .count,
        ).toBe(1);
        expect(
          (
            await tx`DELETE FROM menu_categories WHERE id = ${category?.id ?? null}`
          ).count,
        ).toBe(1);
        expect(
          (
            await tx`DELETE FROM restaurant_tables WHERE id = ${table?.id ?? null}`
          ).count,
        ).toBe(1);
      });
    } finally {
      await dropRestaurant(sql, restaurantId);
    }
  });

  it("не имеет доступа к служебной таблице миграций", async () => {
    await expect(
      asRole("portal_app", (tx) => tx`SELECT * FROM schema_migrations LIMIT 1`),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("может выполнять функции броней", async () => {
    await expect(
      asRole(
        "portal_app",
        (tx) => tx`SELECT * FROM find_available_slots(
          '00000000-0000-0000-0000-000000000000'::uuid, current_date, 2, NULL, 5)`,
      ),
    ).rejects.toMatchObject({ code: "45000" });
  });

  it("может бронировать столик на день и снимать бронь", async () => {
    // Ресторана нет — ждём доменную 45000, а НЕ отказ в правах 42501.
    for (const call of [
      "SELECT * FROM book_table_for_day('00000000-0000-0000-0000-000000000000'::uuid," +
        " '00000000-0000-0000-0000-000000000000'::uuid, current_date, time '12:00', 2, 'x', 'portal')",
      "SELECT cancel_table_booking('00000000-0000-0000-0000-000000000000'::uuid," +
        " '00000000-0000-0000-0000-000000000000'::uuid, current_date)",
    ]) {
      await expect(
        asRole("portal_app", (tx) => tx.unsafe(call)),
      ).rejects.toMatchObject({ code: "45000" });
    }
  });
});

describe("владелец схемы", () => {
  it("функции §5.2 объявлены SECURITY DEFINER и принадлежат app_owner", async () => {
    const rows = await sql<
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
        'create_callback_request','purge_expired_personal_data',
        'book_table_for_day','cancel_table_booking')`;

    expect(rows).toHaveLength(10);
    for (const row of rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.owner).toBe("app_owner");
      // SECURITY DEFINER без фиксированного search_path небезопасен
      expect(row.config?.join(",")).toMatch(/search_path=/);
    }
  });
});
