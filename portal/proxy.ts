import { type NextRequest, NextResponse } from "next/server";
import { getConfig } from "./lib/config";
import { SESSION_COOKIE, verifySession } from "./lib/session";

/**
 * Первый рубеж защиты (в Next 16 бывший middleware): без валидной сессии страницы уходят
 * на форму входа, а API — в 401. Второй рубеж — `guardRequest` и `requireSessionForPage`
 * в самих маршрутах: PROJECT.md §7.2 требует независимой проверки роли на сервере.
 *
 * Proxy в Next 16 всегда исполняется в рантайме Node, поэтому конфигурация читается тем же
 * модулем, что и в остальном приложении, без оговорок про доступность `process.env` в Edge.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const PUBLIC_PATHS = new Set(["/login", "/api/login"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    getConfig().SESSION_SECRET,
  );
  if (session) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
