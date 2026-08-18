import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { TEST_SESSION_SECRET, testEnv } from "./fixtures";

/**
 * Маршруты столиков. Базы здесь нет: соединение и репозиторий подменены, потому что
 * проверяется обвязка — роль, разбор тела, коды ответов (AGENTS.md §4).
 * Работу самих запросов проверяет `portal/tests/db/tables-repo.test.ts`.
 */

const RESTAURANT_ID = "10000000-0000-0000-0000-000000000001";
const TABLE_ID = "11000000-0000-0000-0000-000000000001";

vi.mock("@/lib/db", () => ({ db: () => ({}) }));
vi.mock("@/lib/restaurant", () => ({
  getRestaurantId: async () => RESTAURANT_ID,
}));
vi.mock("@/lib/tables", () => ({
  createTable: vi.fn(),
  updateTable: vi.fn(),
  deleteTable: vi.fn(),
}));

const VALID = {
  label: "T9",
  seats: 4,
  zone: "Terrasse",
  isActive: true,
  combinable: false,
};

const SAVED = { id: TABLE_ID, ...VALID };

let repo: {
  createTable: ReturnType<typeof vi.fn>;
  updateTable: ReturnType<typeof vi.fn>;
  deleteTable: ReturnType<typeof vi.fn>;
};
let POST: (request: NextRequest) => Promise<Response>;
let PATCH: (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;
let DELETE: (
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
  repo = (await import("@/lib/tables")) as unknown as typeof repo;
  ({ POST } = await import("@/app/api/tables/route"));
  ({ PATCH, DELETE } = await import("@/app/api/tables/[id]/route"));

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
  vi.mocked(repo.createTable).mockReset().mockResolvedValue(SAVED);
  vi.mocked(repo.updateTable).mockReset().mockResolvedValue(SAVED);
  vi.mocked(repo.deleteTable).mockReset().mockResolvedValue(true);
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

describe("POST /api/tables", () => {
  it("отказывает без сессии", async () => {
    const response = await POST(make("POST", "/api/tables", { body: VALID }));
    expect(response.status).toBe(401);
    expect(repo.createTable).not.toHaveBeenCalled();
  });

  it("отказывает оператору: скрытая кнопка защитой не является (§7.2)", async () => {
    const response = await POST(
      make("POST", "/api/tables", {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(repo.createTable).not.toHaveBeenCalled();
  });

  it("создаёт столик администратору", async () => {
    const response = await POST(
      make("POST", "/api/tables", {
        cookie: await cookieFor("admin"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(SAVED);
    expect(repo.createTable).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      expect.objectContaining({ label: "T9", seats: 4 }),
    );
  });

  it("отвергает тело за пределами CHECK базы", async () => {
    const response = await POST(
      make("POST", "/api/tables", {
        cookie: await cookieFor("admin"),
        body: { ...VALID, seats: 99 },
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(
      "invalid_body",
    );
    expect(repo.createTable).not.toHaveBeenCalled();
  });

  it("превращает нарушение уникальности в 409", async () => {
    vi.mocked(repo.createTable).mockRejectedValue({ code: "23505" });
    const response = await POST(
      make("POST", "/api/tables", {
        cookie: await cookieFor("admin"),
        body: VALID,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "duplicate" });
  });
});

describe("PATCH /api/tables/[id]", () => {
  it("отказывает оператору", async () => {
    const response = await PATCH(
      make("PATCH", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("operator"),
        body: VALID,
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(403);
  });

  it("сохраняет изменения администратору", async () => {
    const response = await PATCH(
      make("PATCH", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("admin"),
        body: { ...VALID, seats: 6 },
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(200);
    expect(repo.updateTable).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      TABLE_ID,
      expect.objectContaining({ seats: 6 }),
    );
  });

  it("отдаёт 404 на чужой или исчезнувший столик", async () => {
    vi.mocked(repo.updateTable).mockResolvedValue(undefined);
    const response = await PATCH(
      make("PATCH", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("admin"),
        body: VALID,
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(404);
  });

  it("отдаёт 404 на идентификатор, который не uuid", async () => {
    const response = await PATCH(
      make("PATCH", "/api/tables/not-a-uuid", {
        cookie: await cookieFor("admin"),
        body: VALID,
      }),
      params("not-a-uuid"),
    );
    expect(response.status).toBe(404);
    expect(repo.updateTable).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/tables/[id]", () => {
  it("отказывает оператору", async () => {
    const response = await DELETE(
      make("DELETE", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("operator"),
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(403);
    expect(repo.deleteTable).not.toHaveBeenCalled();
  });

  it("удаляет и отвечает без тела", async () => {
    const response = await DELETE(
      make("DELETE", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("admin"),
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(204);
  });

  it("превращает отказ ON DELETE RESTRICT в 409 in_use", async () => {
    // 23001 restrict_violation — код, который база реально возвращает
    // (проверено в portal/tests/db/tables-repo.test.ts).
    vi.mocked(repo.deleteTable).mockRejectedValue({ code: "23001" });
    const response = await DELETE(
      make("DELETE", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("admin"),
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "in_use" });
  });

  it("отдаёт 404, если строки не было", async () => {
    vi.mocked(repo.deleteTable).mockResolvedValue(false);
    const response = await DELETE(
      make("DELETE", `/api/tables/${TABLE_ID}`, {
        cookie: await cookieFor("admin"),
      }),
      params(TABLE_ID),
    );
    expect(response.status).toBe(404);
  });
});
