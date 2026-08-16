import { type NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import {
  clearLoginAttempts,
  clientKey,
  consumeLoginAttempt,
} from "@/lib/rate-limit";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";
import { authenticate } from "@/lib/users";

/** `bcryptjs` требует Node-рантайма. */
export const runtime = "nodejs";

interface Credentials {
  username: string;
  password: string;
}

function readCredentials(body: unknown): Credentials | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") {
    return undefined;
  }
  if (!username || !password) {
    return undefined;
  }
  return { username, password };
}

export async function POST(request: NextRequest) {
  const config = getConfig();
  const key = clientKey(request.headers);

  // Лимит расходуется до разбора тела: иначе перебор с пустым телом не считался бы попыткой.
  const verdict = consumeLoginAttempt(key);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: verdict.retryAfterSeconds },
      {
        status: 429,
        headers: { "Retry-After": String(verdict.retryAfterSeconds) },
      },
    );
  }

  const credentials = readCredentials(await request.json().catch(() => null));
  if (!credentials) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const session = await authenticate(
    credentials.username,
    credentials.password,
    config,
  );
  if (!session) {
    // Логин и причина отказа не логируются: PROJECT.md §0.4 запрещает персональные данные в логах.
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  clearLoginAttempts(key);

  const token = await signSession(session, config.SESSION_SECRET);
  const response = NextResponse.json({ role: session.role });
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(config.PORTAL_COOKIE_SECURE),
  );
  return response;
}
