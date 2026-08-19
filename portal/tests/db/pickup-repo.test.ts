import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrder, listOrdersForToday, updateOrderStatus } from "@/lib/pickup";
// Без расширения `.ts`: файл проверяется конфигурацией портала
// (`moduleResolution: bundler`), где явное расширение запрещено.
import { testDatabaseUrl } from "../../../db/tests/helpers/db";
import {
  addCategory,
  addMenuItem,
  createRestaurant,
  dropRestaurant,
  openAllWeek,
} from "../../../db/tests/helpers/fixtures";

/**
 * Репозиторий самовывоза против настоящего Postgres. Проверяется то, чего не видно
 * на моках: отбор ровно за сегодняшний местный день, сборка позиций с пометками,
 * изоляция по ресторану и вызов `create_pickup_order_atomic`.
 */

const sql = postgres(testDatabaseUrl(), { max: 2 });

/**
 * Таймзона, в которой у ресторана сейчас полдень. Иначе тест был бы привязан к часу
 * запуска: заказ создаётся на сегодня, а «сегодня» кончается в местную полночь, и
 * ночной прогон не нашёл бы будущего времени выдачи внутри дня.
 *
 * `Etc/GMT` инвертирует знак: `Etc/GMT-3` — это UTC+3.
 */
function noonZone(now: Date = new Date()): string {
  const offset = 12 - now.getUTCHours();
  if (offset === 0) {
    return "UTC";
  }
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/** Местное настенное время «сейчас плюс час», уже выровненное по сетке в 15 минут. */
const READY_TIME = "13:30";

/** Текущий местный час ровно — заведомо не проходит `pickup_lead_minutes`. */
const TOO_EARLY_TIME = "12:00";

let restaurantId: string;
let otherId: string;
let pizzaId: string;
let saladId: string;

beforeAll(async () => {
  const timezone = noonZone();
  restaurantId = await createRestaurant(sql, "pickup-repo", { timezone });
  otherId = await createRestaurant(sql, "pickup-repo-other", { timezone });
  await openAllWeek(sql, restaurantId);
  await openAllWeek(sql, otherId);

  const category = await addCategory(sql, restaurantId, "Pizza");
  pizzaId = await addMenuItem(sql, category, {
    nameDe: "Margherita",
    nameRu: "Маргарита",
    nameEn: "Margherita",
    priceCents: 950,
  });
  saladId = await addMenuItem(sql, category, {
    nameDe: "Caesar",
    nameRu: "Цезарь",
    nameEn: "Caesar",
    priceCents: 750,
  });
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await dropRestaurant(sql, otherId);
  await sql.end();
});

/**
 * Заказ прямо в таблицу, без RPC: так задаётся момент выдачи относительно «сейчас»,
 * что для проверки отбора по дню и надёжнее, и точнее. Сдвиг задаётся интервалом,
 * поэтому заказ никогда не попадает на границу суток случайно.
 */
async function insertOrder(
  restaurant: string,
  orderNumber: string,
  shift: string,
  status = "new",
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO pickup_orders (restaurant_id, order_number, guest_name, ready_at,
                               total_cents, status, source, language)
    VALUES (${restaurant}, ${orderNumber}, 'Gast', now() + ${shift}::interval,
            1700, ${status}, 'portal', 'de')
    RETURNING id`;
  if (!row) {
    throw new Error("фикстура заказа не создалась");
  }
  return row.id;
}

describe("listOrdersForToday", () => {
  it("берёт только сегодняшний местный день и только свой ресторан", async () => {
    const today = await insertOrder(restaurantId, "1001", "0 minutes");
    await insertOrder(restaurantId, "1002", "-1 day");
    await insertOrder(restaurantId, "1003", "1 day");
    await insertOrder(otherId, "1004", "0 minutes");

    const orders = await listOrdersForToday(sql, restaurantId);

    expect(orders.map((order) => order.id)).toEqual([today]);
    expect(orders[0]?.orderNumber).toBe("1001");
  });

  it("отдаёт закрытые заказы тоже: колонки «забраны» и «отменены» живут на той же доске", async () => {
    await insertOrder(restaurantId, "2001", "0 minutes", "picked_up");
    await insertOrder(restaurantId, "2002", "0 minutes", "cancelled");

    const orders = await listOrdersForToday(sql, restaurantId);
    const statuses = orders.map((order) => order.status);

    expect(statuses).toContain("picked_up");
    expect(statuses).toContain("cancelled");
  });

  it("отдаёт момент выдачи в UTC и местное время отдельно", async () => {
    const orders = await listOrdersForToday(sql, restaurantId);
    const order = orders[0];

    expect(order).toBeDefined();
    // Строка должна разбираться `Date.parse` — по ней доска считает срочность карточки.
    expect(Number.isNaN(Date.parse(order?.readyAt ?? ""))).toBe(false);
    expect(order?.readyAtLocal).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});

describe("createOrder", () => {
  it("создаёт заказ через RPC: сумму и номер считает база", async () => {
    const created = await createOrder(sql, restaurantId, {
      time: READY_TIME,
      guestName: "Frau Meier",
      guestPhone: null,
      items: [
        { menuItemId: pizzaId, quantity: 2, note: "ohne Zwiebeln" },
        { menuItemId: saladId, quantity: 1, note: null },
      ],
    });

    expect(created.totalCents).toBe(2 * 950 + 750);
    expect(created.orderNumber).toMatch(/^[0-9]{4}$/);
    expect(created.readyAtLocal).toBe(READY_TIME);

    const orders = await listOrdersForToday(sql, restaurantId);
    const order = orders.find((candidate) => candidate.id === created.id);

    expect(order?.guestName).toBe("Frau Meier");
    expect(order?.status).toBe("new");
    expect(order?.source).toBe("portal");
    // Позиции отсортированы по названию: «Маргарита» после «Цезарь» по алфавиту.
    expect(order?.items.map((line) => [line.name, line.quantity, line.note])).toEqual([
      ["Маргарита", 2, "ohne Zwiebeln"],
      ["Цезарь", 1, null],
    ]);
  });

  it("отдаёт 45010, если выдача раньше времени на приготовление", async () => {
    await expect(
      createOrder(sql, restaurantId, {
        time: TOO_EARLY_TIME,
        guestName: "Gast",
        guestPhone: null,
        items: [{ menuItemId: pizzaId, quantity: 1, note: null }],
      }),
    ).rejects.toMatchObject({ code: "45010" });
  });

  it("отдаёт 45003 на блюдо чужого ресторана", async () => {
    const otherCategory = await addCategory(sql, otherId, "Pizza");
    const otherItem = await addMenuItem(sql, otherCategory, {
      nameDe: "Fremd",
      nameRu: "Чужое",
      nameEn: "Foreign",
    });

    await expect(
      createOrder(sql, restaurantId, {
        time: READY_TIME,
        guestName: "Gast",
        guestPhone: null,
        items: [{ menuItemId: otherItem, quantity: 1, note: null }],
      }),
    ).rejects.toMatchObject({ code: "45003" });
  });
});

describe("updateOrderStatus", () => {
  it("переводит заказ и возвращает новый статус", async () => {
    const id = await insertOrder(restaurantId, "3001", "0 minutes");

    const changed = await updateOrderStatus(sql, restaurantId, id, "preparing");

    expect(changed).toEqual({ id, status: "preparing" });
  });

  it("не трогает заказ чужого ресторана", async () => {
    const id = await insertOrder(otherId, "3002", "0 minutes");

    const changed = await updateOrderStatus(sql, restaurantId, id, "ready");

    expect(changed).toBeUndefined();
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM pickup_orders WHERE id = ${id}`;
    expect(row?.status).toBe("new");
  });
});
