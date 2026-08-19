import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { TEST_SESSION_SECRET, testEnv } from "./fixtures";

/**
 * Маршруты самовывоза. Базы здесь нет: соединение и репозиторий подменены, потому что
 * проверяется обвязка — роль, разбор тела, коды ответов (AGENTS.md §4). Работу самих
 * запросов проверяет `portal/tests/db/pickup-repo.test.ts`.
 *
 * Главное отличие от справочников: заказы ведут ОБЕ роли (PROJECT.md §7.2), поэтому
 * здесь проверяется не отказ оператору, а наоборот — что он допущен.
 */

const RESTAURANT_ID = "10000000-0000-0000-0000-000000000001";
const ORDER_ID = "13000000-0000-0000-0000-000000000001";
const ITEM_ID = "14000000-0000-0000-0000-000000000001";

vi.mock("@/lib/db", () => ({ db: () => ({}) }));
vi.mock("@/lib/restaurant", () => ({
  getRestaurantId: async () => RESTAURANT_ID,
}));
vi.mock("@/lib/pickup", () => ({
  createOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  listOrdersForToday: vi.fn(),
}));

const VALID = {
  time: "18:30",
  guestName: "Frau Meier",
  guestPhone: "+4930111222",
  items: [{ menuItemId: ITEM_ID, quantity: 2, note: "ohne Zwiebeln" }],
};

const CREATED = {
  id: ORDER_ID,
  orderNumber: "4711",
  totalCents: 1900,
  readyAtLocal: "18:30",
};

let repo: {
  createOrder: ReturnType<typeof vi.fn>;
  updateOrderStatus: ReturnType<typeof vi.fn>;
};
let POST: (request: NextRequest) => Promise<Response>;
let PATCH: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
let make: (
  method: string,
  path: string,
  options?: { cookie?: string; body?: unknown },
) => NextRequest;

beforeAll(async () => {
  Object.assign(process.env, await testEnv());
  repo = (await import("@/lib/pickup")) as unknown as typeof repo;
  ({ POST } = await import("@/app/api/pickup/route"));
  ({ PATCH } = await import("@/app/api/pickup/[id]/status/route"));

  const { NextRequest } = await import("next/server");
  make = (method, path, options = {}) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.cookie ? { cookie: options.cookie } : {}),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
});

beforeEach(() => {
  vi.mocked(repo.createOrder).mockReset().mockResolvedValue(CREATED);
  vi.mocked(repo.updateOrderStatus)
    .mockReset()
    .mockResolvedValue({ id: ORDER_ID, status: "preparing" });
});

async function cookieFor(role: "admin" | "operator"): Promise<string> {
  const token = await signSession(
    { username: role, role },
    TEST_SESSION_SECRET,
  );
  return `${SESSION_COOKIE}=${token}`;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/pickup", () => {
  it("отказывает без сессии", async () => {
    const response = await POST(make("POST", "/api/pickup", { body: VALID }));
    expect(response.status).toBe(401);
    expect(repo.createOrder).not.toHaveBeenCalled();
  });

  it("создаёт заказ оператору: заказы ведут обе роли (§7.2)", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(CREATED);
    expect(repo.createOrder).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      expect.objectContaining({ guestName: "Frau Meier" }),
    );
  });

  it("создаёт заказ администратору", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("admin"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(201);
  });

  it("отвергает время вне сетки в 15 минут", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: { ...VALID, time: "18:07" },
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "invalid_body",
    );
    expect(repo.createOrder).not.toHaveBeenCalled();
  });

  it("отвергает заказ без позиций", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: { ...VALID, items: [] },
      }),
    );
    expect(response.status).toBe(400);
    expect(repo.createOrder).not.toHaveBeenCalled();
  });

  it("отвергает количество за пределами CHECK базы", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: { ...VALID, items: [{ menuItemId: ITEM_ID, quantity: 51 }] },
      }),
    );
    expect(response.status).toBe(400);
    expect(repo.createOrder).not.toHaveBeenCalled();
  });

  it("отвергает пустое имя гостя", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: { ...VALID, guestName: "   " },
      }),
    );
    expect(response.status).toBe(400);
    expect(repo.createOrder).not.toHaveBeenCalled();
  });

  it("принимает заказ без телефона", async () => {
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: { ...VALID, guestPhone: "" },
      }),
    );
    expect(response.status).toBe(201);
    expect(repo.createOrder).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      expect.objectContaining({ guestPhone: null }),
    );
  });

  it("превращает занятый слот (45002) в 409", async () => {
    vi.mocked(repo.createOrder).mockRejectedValue({ code: "45002" });
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "slot_full" });
  });

  it("превращает слишком раннее время (45010) в 400", async () => {
    vi.mocked(repo.createOrder).mockRejectedValue({ code: "45010" });
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "pickup_too_early" });
  });

  it("превращает недоступное блюдо (45003) в 400", async () => {
    vi.mocked(repo.createOrder).mockRejectedValue({ code: "45003" });
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "item_unavailable" });
  });

  it("прячет неизвестную ошибку базы за 500", async () => {
    vi.mocked(repo.createOrder).mockRejectedValue({ code: "42P01" });
    const response = await POST(
      make("POST", "/api/pickup", {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal_error" });
  });
});

describe("PATCH /api/pickup/[id]/status", () => {
  it("отказывает без сессии", async () => {
    const response = await PATCH(
      make("PATCH", `/api/pickup/${ORDER_ID}/status`, {
        body: { status: "preparing" },
      }),
      params(ORDER_ID),
    );
    expect(response.status).toBe(401);
    expect(repo.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("переводит заказ по требованию оператора", async () => {
    const response = await PATCH(
      make("PATCH", `/api/pickup/${ORDER_ID}/status`, {
        cookie: await cookieFor("operator"),
        body: { status: "preparing" },
      }),
      params(ORDER_ID),
    );
    expect(response.status).toBe(200);
    expect(repo.updateOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      ORDER_ID,
      "preparing",
    );
  });

  it("разрешает возврат назад: оператор мог ошибиться", async () => {
    vi.mocked(repo.updateOrderStatus).mockResolvedValue({
      id: ORDER_ID,
      status: "new",
    });
    const response = await PATCH(
      make("PATCH", `/api/pickup/${ORDER_ID}/status`, {
        cookie: await cookieFor("admin"),
        body: { status: "new" },
      }),
      params(ORDER_ID),
    );
    expect(response.status).toBe(200);
  });

  it("отвергает статус вне списка базы", async () => {
    const response = await PATCH(
      make("PATCH", `/api/pickup/${ORDER_ID}/status`, {
        cookie: await cookieFor("operator"),
        body: { status: "done" },
      }),
      params(ORDER_ID),
    );
    expect(response.status).toBe(400);
    expect(repo.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("отдаёт 404 на идентификатор, который не uuid", async () => {
    const response = await PATCH(
      make("PATCH", "/api/pickup/не-uuid/status", {
        cookie: await cookieFor("operator"),
        body: { status: "ready" },
      }),
      params("не-uuid"),
    );
    expect(response.status).toBe(404);
    expect(repo.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("отдаёт 404 на чужой или исчезнувший заказ", async () => {
    vi.mocked(repo.updateOrderStatus).mockResolvedValue(undefined);
    const response = await PATCH(
      make("PATCH", `/api/pickup/${ORDER_ID}/status`, {
        cookie: await cookieFor("operator"),
        body: { status: "ready" },
      }),
      params(ORDER_ID),
    );
    expect(response.status).toBe(404);
  });

  it("превращает занятый номер заказа (23505) в 409", async () => {
    // Возврат в активный статус, когда номер уже занят другим активным заказом:
    // это держит частичный уникальный индекс pickup_orders_active_number_uk.
    vi.mocked(repo.updateOrderStatus).mockRejectedValue({ code: "23505" });
    const response = await PATCH(
      make("PATCH", `/api/pickup/${ORDER_ID}/status`, {
        cookie: await cookieFor("operator"),
        body: { status: "new" },
      }),
      params(ORDER_ID),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "duplicate" });
  });
});
