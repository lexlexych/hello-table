import type { NextRequest, NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LOGIN_MAX_ATTEMPTS, resetRateLimit } from "@/lib/rate-limit";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import {
  TEST_ADMIN_PASSWORD,
  TEST_OPERATOR_PASSWORD,
  TEST_SESSION_SECRET,
  testEnv,
} from "./fixtures";

const URL_UNDER_TEST = "http://localhost:3000/api/login";

let POST: (request: NextRequest) => Promise<NextResponse>;
let makeRequest: (body: unknown) => NextRequest;

beforeAll(async () => {
  Object.assign(process.env, await testEnv());
  ({ POST } = await import("@/app/api/login/route"));

  const { NextRequest } = await import("next/server");
  makeRequest = (body: unknown) =>
    new NextRequest(URL_UNDER_TEST, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
});

beforeEach(() => {
  resetRateLimit();
});

describe("POST /api/login", () => {
  it("выдаёт сессию с ролью администратора", async () => {
    const response = await POST(
      makeRequest({ username: "admin", password: TEST_ADMIN_PASSWORD }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "admin" });

    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");
    expect(await verifySession(cookie?.value, TEST_SESSION_SECRET)).toEqual({
      username: "admin",
      role: "admin",
    });
  });

  it("выдаёт роль оператора оператору", async () => {
    const response = await POST(
      makeRequest({ username: "operator", password: TEST_OPERATOR_PASSWORD }),
    );
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(await verifySession(cookie?.value, TEST_SESSION_SECRET)).toEqual({
      username: "operator",
      role: "operator",
    });
  });

  it("отвергает неверный пароль без выдачи cookie", async () => {
    const response = await POST(
      makeRequest({ username: "admin", password: "wrong" }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_credentials" });
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("отвергает неполное тело запроса", async () => {
    const response = await POST(makeRequest({ username: "admin" }));
    expect(response.status).toBe(400);
  });

  it("после пяти неудач шестая попытка получает 429", async () => {
    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
      const response = await POST(
        makeRequest({ username: "admin", password: "wrong" }),
      );
      expect(response.status).toBe(401);
    }

    const blocked = await POST(
      makeRequest({ username: "admin", password: TEST_ADMIN_PASSWORD }),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(blocked.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("успешный вход обнуляет счётчик попыток", async () => {
    for (let attempt = 1; attempt < LOGIN_MAX_ATTEMPTS; attempt += 1) {
      await POST(makeRequest({ username: "admin", password: "wrong" }));
    }
    const ok = await POST(
      makeRequest({ username: "admin", password: TEST_ADMIN_PASSWORD }),
    );
    expect(ok.status).toBe(200);

    const again = await POST(
      makeRequest({ username: "admin", password: "wrong" }),
    );
    expect(again.status).toBe(401);
  });
});
