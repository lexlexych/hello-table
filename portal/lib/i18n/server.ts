import { cookies } from "next/headers";
import { type PortalLocale, resolvePortalLocale } from "./catalog";

export const PORTAL_LOCALE_COOKIE = "portal_locale";
export const PORTAL_LOCALE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export async function getPortalLocale(): Promise<PortalLocale> {
  const value = (await cookies()).get(PORTAL_LOCALE_COOKIE)?.value;
  return resolvePortalLocale(value);
}

export function portalLocaleCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "strict" as const,
    secure,
    path: "/" as const,
    maxAge: PORTAL_LOCALE_MAX_AGE_SECONDS,
  };
}
