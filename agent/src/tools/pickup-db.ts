import {
  type CheckPickupSlotsRequest,
  type CheckPickupSlotsResponse,
  type CreatePickupOrderRequest,
  type CreatePickupOrderResponse,
  checkPickupSlotsResponseSchema,
  createPickupOrderResponseSchema,
  type Language,
  type PickupSlot,
} from "@hello-table/contracts";
import { log } from "@livekit/agents";
import { formatPrice } from "../formatting.ts";
import type { AgentDatabase, DatabaseOutcome } from "./database.ts";
import { toToolError } from "./database.ts";

/**
 * Прямые вызовы RPC самовывоза. Обе функции базы — местные обёртки `*_local`: роль
 * `agent_app` не имеет прав на таблицы и не может прочитать часовой пояс ресторана,
 * поэтому и вход, и выход у них в местных дате и времени (docs/tool-contracts.md).
 */

type SlotsInput = Omit<CheckPickupSlotsRequest, "session_id">;
type OrderInput = Omit<CreatePickupOrderRequest, "session_id">;

type SlotsSuccess = Extract<CheckPickupSlotsResponse, { ok: true }>;
type OrderSuccess = Extract<CreatePickupOrderResponse, { ok: true }>;

interface SlotRow {
  ready_at: Date | string;
  date: string;
  time: string;
}

interface OrderRow {
  order_id: string;
  order_number: string;
  total_cents: number;
  ready_at: Date | string;
  ready_date: string;
  ready_time: string;
}

function timestampText(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Корзина уходит в базу как jsonb. `sql.json` обязателен: обычный массив postgres.js
 * отправил бы строкой, а не массивом, и `pickup_items_expand` его не разобрал бы.
 * Ключи — snake_case, ровно те, что читает эта функция.
 */
function itemsJson(sql: AgentDatabase, input: SlotsInput | OrderInput) {
  return sql.json(
    input.items.map((item) => ({
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      note: item.note,
    })),
  );
}

/** Вызывает find_pickup_slots_local: когда заказ можно забрать. */
export async function findPickupSlots(
  sql: AgentDatabase,
  input: SlotsInput,
): Promise<DatabaseOutcome<SlotsSuccess>> {
  const logger = log().child({ rpc: "find_pickup_slots_local" });
  const startedAt = Date.now();
  try {
    // Настенное время и дата приходят из базы готовым текстом: собирать их из момента
    // времени в агенте нельзя, часовой пояс ресторана ему неизвестен.
    const rows = await sql<SlotRow[]>`
      SELECT pickup_slot_at AS ready_at,
             to_char(pickup_slot_date, 'YYYY-MM-DD') AS date,
             pickup_slot_time AS time
      FROM find_pickup_slots_local(
        ${input.restaurant_id}::uuid,
        ${itemsJson(sql, input)}::jsonb,
        ${input.date}::date,
        ${input.time}::time,
        3::int
      )
    `;
    const slots: PickupSlot[] = rows.map((row) => ({
      ready_at: timestampText(row.ready_at),
      date: row.date,
      time: row.time,
    }));
    const response = checkPickupSlotsResponseSchema.safeParse({
      ok: true,
      slots,
    });
    if (!response.success || !response.data.ok) {
      logger.warn({ result: "invalid_response" }, "database rpc");
      return { ok: false, error: "invalid_response" };
    }
    logger.info(
      { result: "ok", slots: slots.length, ms: Date.now() - startedAt },
      "database rpc",
    );
    return { ok: true, value: response.data };
  } catch (error) {
    const result = toToolError(error);
    logger.warn({ result, ms: Date.now() - startedAt }, "database rpc");
    return { ok: false, error: result };
  }
}

/** Вызывает атомарное оформление заказа на самовывоз. */
export async function createPickupOrder(
  sql: AgentDatabase,
  input: OrderInput,
  language: Language,
): Promise<DatabaseOutcome<OrderSuccess>> {
  const logger = log().child({ rpc: "create_pickup_order_local" });
  const startedAt = Date.now();
  try {
    const rows = await sql<OrderRow[]>`
      SELECT created_order_id     AS order_id,
             created_order_number AS order_number,
             created_total_cents  AS total_cents,
             created_ready_at     AS ready_at,
             to_char(created_ready_date, 'YYYY-MM-DD') AS ready_date,
             created_ready_time   AS ready_time
      FROM create_pickup_order_local(
        ${input.restaurant_id}::uuid,
        ${itemsJson(sql, input)}::jsonb,
        ${input.date}::date,
        ${input.time}::time,
        ${input.guest_name}::text,
        ${input.guest_phone}::text,
        ${input.language}::char(2),
        'phone'::text
      )
    `;
    const row = rows[0];
    const response = createPickupOrderResponseSchema.safeParse(
      row
        ? {
            ok: true,
            order_id: row.order_id,
            order_number: row.order_number,
            total_cents: row.total_cents,
            // Сумму форматирует агент: модель не должна собирать её из центов сама.
            total: formatPrice(row.total_cents, language),
            ready_at: timestampText(row.ready_at),
            ready_date: row.ready_date,
            ready_time: row.ready_time,
          }
        : undefined,
    );
    if (!response.success || !response.data.ok) {
      logger.warn({ result: "invalid_response" }, "database rpc");
      return { ok: false, error: "invalid_response" };
    }
    logger.info({ result: "ok", ms: Date.now() - startedAt }, "database rpc");
    return { ok: true, value: response.data };
  } catch (error) {
    const result = toToolError(error);
    logger.warn({ result, ms: Date.now() - startedAt }, "database rpc");
    return { ok: false, error: result };
  }
}
