import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { TEST_SESSION_SECRET, testEnv } from "./fixtures";

/** Как и в `tables-route.test.ts`: проверяется обвязка, база подменена. */

const RESTAURANT_ID = "10000000-0000-0000-0000-000000000001";
const CATEGORY_ID = "20000000-0000-0000-0000-000000000001";
const ITEM_ID = "30000000-0000-0000-0000-000000000001";

vi.mock("@/lib/db", () => ({ db: () => ({}) }));
vi.mock("@/lib/restaurant", () => ({
  getRestaurantId: async () => RESTAURANT_ID,
}));
vi.mock("@/lib/menu", () => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const VALID_CATEGORY = {
  nameDe: "Vorspeisen",
  nameRu: "Закуски",
  nameEn: "Starters",
  sortOrder: 10,
};

const VALID_ITEM = {
  categoryId: CATEGORY_ID,
  nameDe: "Suppe",
  nameRu: "Суп",
  nameEn: "Soup",
  descriptionDe: "",
  descriptionRu: "",
  descriptionEn: "",
  priceCents: 950,
  allergens: ["celery"],
  aliases: ["Tagessuppe"],
  isVegetarian: true,
  isVegan: false,
  isAvailable: true,
  prepMinutes: 15,
};

const SAVED_CATEGORY = { id: CATEGORY_ID, ...VALID_CATEGORY };
const SAVED_ITEM = { id: ITEM_ID, ...VALID_ITEM };

interface Repo {
  createCategory: ReturnType<typeof vi.fn>;
  updateCategory: ReturnType<typeof vi.fn>;
  deleteCategory: ReturnType<typeof vi.fn>;
  createItem: ReturnType<typeof vi.fn>;
  updateItem: ReturnType<typeof vi.fn>;
  deleteItem: ReturnType<typeof vi.fn>;
}

type Handler = (request: NextRequest) => Promise<Response>;
type IdHandler = (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

let repo: Repo;
let postCategory: Handler;
let deleteCategoryRoute: IdHandler;
let postItem: Handler;
let patchItem: IdHandler;
let deleteItemRoute: IdHandler;
let make: (
  method: string,
  path: string,
  options?: { cookie?: string; body?: unknown },
) => NextRequest;

beforeAll(async () => {
  Object.assign(process.env, await testEnv());
  repo = (await import("@/lib/menu")) as unknown as Repo;
  ({ POST: postCategory } = await import("@/app/api/menu/categories/route"));
  ({ DELETE: deleteCategoryRoute } = await import(
    "@/app/api/menu/categories/[id]/route"
  ));
  ({ POST: postItem } = await import("@/app/api/menu/items/route"));
  ({ PATCH: patchItem, DELETE: deleteItemRoute } = await import(
    "@/app/api/menu/items/[id]/route"
  ));

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
  vi.mocked(repo.createCategory).mockReset().mockResolvedValue(SAVED_CATEGORY);
  vi.mocked(repo.updateCategory).mockReset().mockResolvedValue(SAVED_CATEGORY);
  vi.mocked(repo.deleteCategory).mockReset().mockResolvedValue(true);
  vi.mocked(repo.createItem).mockReset().mockResolvedValue(SAVED_ITEM);
  vi.mocked(repo.updateItem).mockReset().mockResolvedValue(SAVED_ITEM);
  vi.mocked(repo.deleteItem).mockReset().mockResolvedValue(true);
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

describe("категории меню", () => {
  it("не пускают без сессии", async () => {
    const response = await postCategory(
      make("POST", "/api/menu/categories", { body: VALID_CATEGORY }),
    );
    expect(response.status).toBe(401);
  });

  it("не пускают оператора", async () => {
    const response = await postCategory(
      make("POST", "/api/menu/categories", {
        cookie: await cookieFor("operator"),
        body: VALID_CATEGORY,
      }),
    );
    expect(response.status).toBe(403);
    expect(repo.createCategory).not.toHaveBeenCalled();
  });

  it("создаются администратору", async () => {
    const response = await postCategory(
      make("POST", "/api/menu/categories", {
        cookie: await cookieFor("admin"),
        body: VALID_CATEGORY,
      }),
    );
    expect(response.status).toBe(201);
    expect(repo.createCategory).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      expect.objectContaining({ nameDe: "Vorspeisen", sortOrder: 10 }),
    );
  });

  it("требуют названия на всех трёх языках", async () => {
    const response = await postCategory(
      make("POST", "/api/menu/categories", {
        cookie: await cookieFor("admin"),
        body: { ...VALID_CATEGORY, nameEn: "  " },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("не удаляются, пока в них есть блюда", async () => {
    vi.mocked(repo.deleteCategory).mockRejectedValue({ code: "23001" });
    const response = await deleteCategoryRoute(
      make("DELETE", `/api/menu/categories/${CATEGORY_ID}`, {
        cookie: await cookieFor("admin"),
      }),
      params(CATEGORY_ID),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "in_use" });
  });
});

describe("блюда меню", () => {
  it("не пускают оператора", async () => {
    const response = await postItem(
      make("POST", "/api/menu/items", {
        cookie: await cookieFor("operator"),
        body: VALID_ITEM,
      }),
    );
    expect(response.status).toBe(403);
    expect(repo.createItem).not.toHaveBeenCalled();
  });

  it("создаются администратору", async () => {
    const response = await postItem(
      make("POST", "/api/menu/items", {
        cookie: await cookieFor("admin"),
        body: VALID_ITEM,
      }),
    );
    expect(response.status).toBe(201);
    expect(repo.createItem).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      expect.objectContaining({ priceCents: 950 }),
    );
  });

  it("отдают 404, если категория чужая — репозиторий не вернул строку", async () => {
    vi.mocked(repo.createItem).mockResolvedValue(undefined);
    const response = await postItem(
      make("POST", "/api/menu/items", {
        cookie: await cookieFor("admin"),
        body: VALID_ITEM,
      }),
    );
    expect(response.status).toBe(404);
  });

  it("не принимают веганское без вегетарианского", async () => {
    const response = await postItem(
      make("POST", "/api/menu/items", {
        cookie: await cookieFor("admin"),
        body: { ...VALID_ITEM, isVegan: true, isVegetarian: false },
      }),
    );
    expect(response.status).toBe(400);
    expect(repo.createItem).not.toHaveBeenCalled();
  });

  it("не принимают аллерген вне списка базы", async () => {
    const response = await postItem(
      make("POST", "/api/menu/items", {
        cookie: await cookieFor("admin"),
        body: { ...VALID_ITEM, allergens: ["honey"] },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("изменяются администратору", async () => {
    const response = await patchItem(
      make("PATCH", `/api/menu/items/${ITEM_ID}`, {
        cookie: await cookieFor("admin"),
        body: { ...VALID_ITEM, priceCents: 1250 },
      }),
      params(ITEM_ID),
    );
    expect(response.status).toBe(200);
    expect(repo.updateItem).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      ITEM_ID,
      expect.objectContaining({ priceCents: 1250 }),
    );
  });

  it("не удаляются, если попали в заказ", async () => {
    vi.mocked(repo.deleteItem).mockRejectedValue({ code: "23001" });
    const response = await deleteItemRoute(
      make("DELETE", `/api/menu/items/${ITEM_ID}`, {
        cookie: await cookieFor("admin"),
      }),
      params(ITEM_ID),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "in_use" });
  });
});
