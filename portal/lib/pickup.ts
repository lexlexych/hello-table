import type { PickupOrderStatus } from "@hello-table/contracts";
import type postgres from "postgres";
import type { PickupOrderInput } from "./schemas/pickup";

/**
 * Доступ к заказам на самовывоз. Как в `tables.ts` и `menu.ts`, соединение и id
 * ресторана приходят параметрами, а каждый запрос ограничен `restaurant_id`.
 *
 * Разделение то же, что на `/tables`: создание заказа идёт только через
 * `create_pickup_order_atomic` (сумма, цены позиций, вместимость слота и номер —
 * зона ответственности базы, PROJECT.md §3.4), а перевод одной строки между
 * статусами делается прямым UPDATE: атомарности и подбора там нет.
 */

/** Позиция заказа в том виде, в каком её показывает карточка. */
export interface PickupOrderLine {
  id: string;
  name: string;
  quantity: number;
  /** Пометка вроде «без лука»; у большинства позиций пустая. */
  note: string | null;
  unitPriceCents: number;
}

export interface PickupOrder {
  id: string;
  orderNumber: string;
  guestName: string;
  guestPhone: string | null;
  status: PickupOrderStatus;
  source: string;
  totalCents: number;
  /** Момент выдачи в UTC (ISO). По нему клиент считает срочность карточки. */
  readyAt: string;
  /** Местное настенное время выдачи, `"18:30"` — только для показа. */
  readyAtLocal: string;
  items: PickupOrderLine[];
}

/**
 * Заказы, которые выдаются сегодня по местному времени ресторана. Доска живёт одним
 * днём (PROJECT.md §7.3): заказ на завтра появится на ней завтра, вчерашний исчезнет.
 *
 * День считает база: часовой пояс ресторана известен только ей, и в 23:30 в Берлине
 * сервер в UTC отобрал бы уже завтрашние заказы.
 */
export async function listOrdersForToday(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<PickupOrder[]> {
  return sql<PickupOrder[]>`
    SELECT po.id,
           po.order_number AS "orderNumber",
           po.guest_name   AS "guestName",
           po.guest_phone  AS "guestPhone",
           po.status,
           po.source,
           po.total_cents  AS "totalCents",
           to_char(po.ready_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "readyAt",
           to_char(po.ready_at AT TIME ZONE r.timezone, 'HH24:MI') AS "readyAtLocal",
           coalesce(lines.items, '[]'::json) AS items
    FROM pickup_orders po
    JOIN restaurants r ON r.id = po.restaurant_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
               'id',             oi.id,
               'name',           mi.name_ru,
               'quantity',       oi.quantity,
               'note',           oi.note,
               'unitPriceCents', oi.unit_price_cents
             ) ORDER BY mi.name_ru) AS items
      FROM pickup_order_items oi
      JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE oi.order_id = po.id
    ) lines ON true
    WHERE po.restaurant_id = ${restaurantId}
      AND (po.ready_at AT TIME ZONE r.timezone)::date
        = (now() AT TIME ZONE r.timezone)::date
    ORDER BY po.ready_at, po.order_number`;
}

export interface PickupOrderStatusChange {
  id: string;
  status: PickupOrderStatus;
}

/**
 * Перевод заказа в другой статус. `undefined` означает «такого заказа в этом ресторане
 * нет» — маршрут отдаст 404.
 *
 * Свободного перехода база не ограничивает: оператор может вернуть заказ назад, если
 * ошибся. Единственное ограничение держит частичный уникальный индекс
 * `pickup_orders_active_number_uk` — вернуть заказ в активный статус нельзя, если его
 * четырёхзначный номер уже занят другим активным заказом. Это приходит как 23505.
 */
export async function updateOrderStatus(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
  status: PickupOrderStatus,
): Promise<PickupOrderStatusChange | undefined> {
  const [row] = await sql<PickupOrderStatusChange[]>`
    UPDATE pickup_orders
    SET status = ${status}
    WHERE id = ${id} AND restaurant_id = ${restaurantId}
    RETURNING id, status`;
  return row;
}

export interface CreatedPickupOrder {
  id: string;
  orderNumber: string;
  totalCents: number;
  /** Местное настенное время выдачи, подтверждённое базой. */
  readyAtLocal: string;
}

/**
 * Создание заказа оператором. Все отказы — исключения с SQLSTATE 45xxx
 * (`db/README.md`); маршрут превращает их в коды ответа.
 *
 * Момент выдачи целиком собирает база: и сегодняшнюю местную дату, и настенное время.
 * Часовой пояс ресторана известен только ей, а доска работает одним днём — поэтому дату
 * не спрашивают ни у оператора, ни у сервера приложения.
 */
export async function createOrder(
  sql: postgres.Sql,
  restaurantId: string,
  input: PickupOrderInput,
): Promise<CreatedPickupOrder> {
  // Ключи внутри jsonb — те, что читает `pickup_items_expand`, то есть snake_case.
  // `sql.json` обязателен: обычный массив уехал бы в базу как JSON-строка, а не array.
  const items = sql.json(
    input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
      note: item.note,
    })),
  );

  const [row] = await sql<CreatedPickupOrder[]>`
    WITH settings AS (
      SELECT timezone, default_language FROM restaurants WHERE id = ${restaurantId}
    ),
    created AS (
      SELECT * FROM create_pickup_order_atomic(
        ${restaurantId},
        ${items},
        (SELECT ((now() AT TIME ZONE s.timezone)::date + ${input.time}::time)
                  AT TIME ZONE s.timezone
         FROM settings s),
        ${input.guestName},
        ${input.guestPhone},
        (SELECT s.default_language FROM settings s),
        'portal')
    )
    SELECT c.pickup_order_id       AS id,
           c.assigned_order_number AS "orderNumber",
           c.order_total_cents     AS "totalCents",
           to_char(c.confirmed_ready_at AT TIME ZONE s.timezone, 'HH24:MI') AS "readyAtLocal"
    FROM created c, settings s`;

  if (!row) {
    throw new Error("create_pickup_order_atomic не вернул строку");
  }
  return row;
}
