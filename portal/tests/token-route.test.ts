import { decodeJwt } from "jose";
import type { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ROOM_PREFIX, TOKEN_TTL_SECONDS } from "@/lib/livekit";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { TEST_SESSION_SECRET, testEnv } from "./fixtures";

const URL_UNDER_TEST = "http://localhost:3000/api/test-call/token";

let POST: (request: NextRequest) => Promise<Response>;
let makeRequest: (cookie?: string) => NextRequest;

beforeAll(async () => {
  Object.assign(process.env, await testEnv());
  ({ POST } = await import("@/app/api/test-call/token/route"));

  const { NextRequest } = await import("next/server");
  makeRequest = (cookie?: string) =>
    new NextRequest(URL_UNDER_TEST, {
      method: "POST",
      headers: cookie ? { cookie } : {},
    });
});

async function adminCookie(): Promise<string> {
  const token = await signSession(
    { username: "admin", role: "admin" },
    TEST_SESSION_SECRET,
  );
  return `${SESSION_COOKIE}=${token}`;
}

interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  roomAdmin?: boolean;
  roomCreate?: boolean;
  roomList?: boolean;
}

describe("POST /api/test-call/token", () => {
  it("отказывает без сессии", async () => {
    const response = await POST(makeRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("отказывает при подделанной подписи", async () => {
    const cookie = `${SESSION_COOKIE}=not.a.token`;
    expect((await POST(makeRequest(cookie))).status).toBe(401);
  });

  it("выдаёт токен обеим ролям", async () => {
    for (const role of ["admin", "operator"] as const) {
      const token = await signSession(
        { username: role, role },
        TEST_SESSION_SECRET,
      );
      const response = await POST(makeRequest(`${SESSION_COOKIE}=${token}`));
      expect(response.status).toBe(200);
    }
  });

  it("выдаёт токен ровно с нужными правами и на свежую комнату", async () => {
    const response = await POST(makeRequest(await adminCookie()));
    expect(response.status).toBe(200);

    const grant = (await response.json()) as {
      url: string;
      token: string;
      room: string;
      identity: string;
    };

    expect(grant.url).toBe("ws://localhost:7880");
    expect(grant.room.startsWith(ROOM_PREFIX)).toBe(true);
    expect(grant.identity.startsWith("portal-admin-")).toBe(true);

    const claims = decodeJwt(grant.token) as {
      sub?: string;
      exp?: number;
      nbf?: number;
      iat?: number;
      video?: VideoGrant;
    };

    expect(claims.sub).toBe(grant.identity);
    expect(claims.video?.room).toBe(grant.room);
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    // Прав администрировать комнаты у браузера быть не должно.
    expect(claims.video?.roomAdmin).toBeUndefined();
    expect(claims.video?.roomCreate).toBeUndefined();
    expect(claims.video?.roomList).toBeUndefined();

    const issuedAt = claims.iat ?? claims.nbf ?? 0;
    expect((claims.exp ?? 0) - issuedAt).toBe(TOKEN_TTL_SECONDS);
  });

  it("не переиспользует комнату между звонками", async () => {
    const cookie = await adminCookie();
    const first = (await (await POST(makeRequest(cookie))).json()) as {
      room: string;
    };
    const second = (await (await POST(makeRequest(cookie))).json()) as {
      room: string;
    };
    expect(first.room).not.toBe(second.room);
  });
});
