import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

/**
 * Сессия портала. Здесь нет ничего, кроме `bcryptjs`-независимой работы с подписью:
 * этот модуль импортируется в том числе из middleware, где нативные модули недоступны.
 */

export const PORTAL_ROLES = ["admin", "operator"] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

export const SESSION_COOKIE = "portal_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const ISSUER = "hello-table-portal";

const claimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(PORTAL_ROLES),
});

export interface Session {
  username: string;
  role: PortalRole;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(
  session: Session,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: session.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.username)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .sign(key(secret));
}

/**
 * Возвращает сессию или `undefined`. Подделанная подпись, чужой секрет, истёкший срок и
 * неизвестная роль неотличимы для вызывающего — все они означают «сессии нет».
 */
export async function verifySession(
  token: string | undefined,
  secret: string,
): Promise<Session | undefined> {
  if (!token) {
    return undefined;
  }
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) {
      return undefined;
    }
    return { username: claims.data.sub, role: claims.data.role };
  } catch {
    return undefined;
  }
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "strict";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
