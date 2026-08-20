import type { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { testEnv } from "./fixtures";

const RESTAURANT_ID = "10000000-0000-0000-0000-000000000001";
const TABLE_ID = "11000000-0000-0000-0000-000000000001";
const RESERVATION_ID = "12000000-0000-0000-0000-000000000001";

vi.mock("@/lib/db", () => ({ db: () => ({}) }));
vi.mock("@/lib/restaurant", () => ({
  getRestaurantId: async () => RESTAURANT_ID,
}));
vi.mock("@/lib/n8n-tools", () => ({
  getN8nMenu: vi.fn(),
  findN8nAvailableTables: vi.fn(),
  createN8nReservation: vi.fn(),
}));

let apiKey: string;
let repo: {
  getN8nMenu: ReturnType<typeof vi.fn>;
  findN8nAvailableTables: ReturnType<typeof vi.fn>;
  createN8nReservation: ReturnType<typeof vi.fn>;
};
let menuPost: (request: NextRequest) => Promise<Response>;
let availabilityPost: (request: NextRequest) => Promise<Response>;
let reservationsPost: (request: NextRequest) => Promise<Response>;
let make: (path: string, body: unknown, authorization?: string) => NextRequest;

beforeAll(async () => {
  const env = await testEnv();
  Object.assign(process.env, env);
  apiKey = env.PORTAL_N8N_API_KEY;
  repo = (await import("@/lib/n8n-tools")) as unknown as typeof repo;
  ({ POST: menuPost } = await import("@/app/api/integrations/n8n/menu/route"));
  ({ POST: availabilityPost } = await import(
    "@/app/api/integrations/n8n/availability/route"
  ));
  ({ POST: reservationsPost } = await import(
    "@/app/api/integrations/n8n/reservations/route"
  ));

  const { NextRequest } = await import("next/server");
  make = (path, body, authorization) =>
    new NextRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    });
});

beforeEach(() => {
  vi.mocked(repo.getN8nMenu).mockReset().mockResolvedValue({
    ok: true,
    categories: [],
  });
  vi.mocked(repo.findN8nAvailableTables).mockReset().mockResolvedValue({
    ok: true,
    tables: [],
  });
  vi.mocked(repo.createN8nReservation).mockReset().mockResolvedValue({
    ok: true,
    reservation_id: RESERVATION_ID,
    table_label: "T1",
    starts_at: "2026-09-01T17:00:00.000Z",
    ends_at: "2026-09-01T18:30:00.000Z",
  });
});

const auth = () => `Bearer ${apiKey}`;

describe("авторизация Portal API для n8n", () => {
  it.each([
    [
      "menu",
      () => menuPost(make("/api/integrations/n8n/menu", { language: "de" })),
    ],
    [
      "availability",
      () =>
        availabilityPost(
          make("/api/integrations/n8n/availability", {
            date: "2026-09-01",
            time: "19:00",
            party_size: 2,
          }),
        ),
    ],
    [
      "reservations",
      () =>
        reservationsPost(
          make("/api/integrations/n8n/reservations", {
            table_id: TABLE_ID,
            date: "2026-09-01",
            time: "19:00",
            party_size: 2,
            guest_name: "Anna",
            language: "de",
          }),
        ),
    ],
  ])("%s отвергает запрос без ключа", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("не принимает другой Bearer-ключ", async () => {
    const response = await menuPost(
      make(
        "/api/integrations/n8n/menu",
        { language: "de" },
        "Bearer another-long-but-wrong-key-0123456789",
      ),
    );
    expect(response.status).toBe(401);
    expect(repo.getN8nMenu).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/n8n/menu", () => {
  it("возвращает типизированное меню", async () => {
    const response = await menuPost(
      make("/api/integrations/n8n/menu", { language: "ru" }, auth()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, categories: [] });
    expect(repo.getN8nMenu).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      { language: "ru" },
    );
  });

  it("возвращает invalid_request для неизвестного языка", async () => {
    const response = await menuPost(
      make("/api/integrations/n8n/menu", { language: "fr" }, auth()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(repo.getN8nMenu).not.toHaveBeenCalled();
  });

  it("не принимает restaurant_id от внешнего workflow", async () => {
    const response = await menuPost(
      make(
        "/api/integrations/n8n/menu",
        { language: "de", restaurant_id: RESTAURANT_ID },
        auth(),
      ),
    );
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(repo.getN8nMenu).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/n8n/availability", () => {
  it("валидирует вход и вызывает RPC-репозиторий", async () => {
    const input = { date: "2026-09-01", time: "19:00", party_size: 4 };
    const response = await availabilityPost(
      make("/api/integrations/n8n/availability", input, auth()),
    );
    expect(response.status).toBe(200);
    expect(repo.findN8nAvailableTables).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      input,
    );
  });

  it("не передаёт мусорную дату в базу", async () => {
    const response = await availabilityPost(
      make(
        "/api/integrations/n8n/availability",
        { date: "завтра", time: "19:00", party_size: 4 },
        auth(),
      ),
    );
    expect(await response.json()).toEqual({
      ok: false,
      error: "invalid_request",
    });
    expect(repo.findN8nAvailableTables).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/n8n/reservations", () => {
  const input = {
    table_id: TABLE_ID,
    date: "2026-09-01",
    time: "19:00",
    party_size: 2,
    guest_name: "  Anna  ",
    language: "de",
  };

  it("создаёт бронь без restaurant_id и телефона из n8n", async () => {
    const response = await reservationsPost(
      make("/api/integrations/n8n/reservations", input, auth()),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).reservation_id).toBe(RESERVATION_ID);
    expect(repo.createN8nReservation).toHaveBeenCalledWith(
      expect.anything(),
      RESTAURANT_ID,
      { ...input, guest_name: "Anna" },
    );
  });

  it("возвращает доменную ошибку как tool envelope с HTTP 200", async () => {
    vi.mocked(repo.createN8nReservation).mockRejectedValue({ code: "45016" });
    const response = await reservationsPost(
      make("/api/integrations/n8n/reservations", input, auth()),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: "table_already_booked",
    });
  });

  it("не раскрывает неожиданную ошибку базы", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(repo.createN8nReservation).mockRejectedValue({
      code: "42P01",
      detail: "guest Anna",
    });
    try {
      const response = await reservationsPost(
        make("/api/integrations/n8n/reservations", input, auth()),
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        ok: false,
        error: "unreachable",
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("Anna");
    } finally {
      log.mockRestore();
    }
  });
});
