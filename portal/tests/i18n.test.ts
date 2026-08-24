import type { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_PORTAL_LOCALE,
  isPortalLocale,
  resolvePortalLocale,
  translate,
} from "@/lib/i18n/catalog";
import {
  PORTAL_LOCALE_COOKIE,
  PORTAL_LOCALE_MAX_AGE_SECONDS,
  portalLocaleCookieOptions,
} from "@/lib/i18n/server";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { TEST_SESSION_SECRET, testEnv } from "./fixtures";

describe("локали портала", () => {
  it("использует немецкий как default и канонический fallback", () => {
    expect(DEFAULT_PORTAL_LOCALE).toBe("de");
    expect(isPortalLocale(undefined)).toBe(false);
    expect(isPortalLocale("broken")).toBe(false);
    expect(resolvePortalLocale(undefined)).toBe("de");
    expect(resolvePortalLocale("broken")).toBe("de");
    expect(resolvePortalLocale("en")).toBe("en");
    expect(translate("de", "nav.settings")).toBe("Einstellungen");
  });

  it("переводит строки и подставляет параметры", () => {
    expect(translate("ru", "nav.settings")).toBe("Настройки");
    expect(translate("en", "nav.newMessages", { count: 3 })).toBe(
      "New messages: 3",
    );
  });

  it("создаёт устойчивую portal-only cookie", () => {
    expect(PORTAL_LOCALE_COOKIE).toBe("portal_locale");
    expect(portalLocaleCookieOptions(false)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
      maxAge: PORTAL_LOCALE_MAX_AGE_SECONDS,
    });
  });
});

describe("PATCH /api/settings/locale", () => {
  let PATCH: (request: NextRequest) => Promise<Response>;
  let NextRequestClass: typeof NextRequest;

  beforeAll(async () => {
    Object.assign(process.env, await testEnv());
    ({ PATCH } = await import("@/app/api/settings/locale/route"));
    ({ NextRequest: NextRequestClass } = await import("next/server"));
  });

  async function request(role: "admin" | "operator", locale: unknown) {
    const token = await signSession(
      { username: role, role },
      TEST_SESSION_SECRET,
    );
    return new NextRequestClass("http://localhost:3000/api/settings/locale", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({ locale }),
    });
  }

  it("сохраняет поддерживаемую локаль администратору", async () => {
    const response = await PATCH(await request("admin", "ru"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "ru" });
    expect(response.headers.get("set-cookie")).toContain("portal_locale=ru");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
  });

  it("отвергает неизвестную локаль и оператора", async () => {
    expect((await PATCH(await request("admin", "fr"))).status).toBe(400);
    expect((await PATCH(await request("operator", "en"))).status).toBe(403);
  });
});
