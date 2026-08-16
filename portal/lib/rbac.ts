import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getConfig } from "./config";
import {
  PORTAL_ROLES,
  type PortalRole,
  SESSION_COOKIE,
  type Session,
  verifySession,
} from "./session";

/**
 * Проверка роли на сервере. PROJECT.md §7.2: скрытая кнопка защитой не является —
 * каждый серверный маршрут проверяет роль независимо от того, что отрисовала страница.
 */

export type Guard =
  | { ok: true; session: Session }
  | { ok: false; status: 401 | 403 };

/** Для маршрутов API: cookie берётся из запроса, поэтому обработчик тестируется без контекста Next. */
export async function guardRequest(
  request: NextRequest,
  roles: readonly PortalRole[] = PORTAL_ROLES,
): Promise<Guard> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token, getConfig().SESSION_SECRET);
  if (!session) {
    return { ok: false, status: 401 };
  }
  if (!roles.includes(session.role)) {
    return { ok: false, status: 403 };
  }
  return { ok: true, session };
}

/** Для серверных компонентов: без сессии — на форму входа. */
export async function requireSessionForPage(
  roles: readonly PortalRole[] = PORTAL_ROLES,
): Promise<Session> {
  const store = await cookies();
  const session = await verifySession(
    store.get(SESSION_COOKIE)?.value,
    getConfig().SESSION_SECRET,
  );
  if (!session) {
    redirect("/login");
  }
  if (!roles.includes(session.role)) {
    redirect("/");
  }
  return session;
}
