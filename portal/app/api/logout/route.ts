import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(getConfig().PORTAL_COOKIE_SECURE),
    maxAge: 0,
  });
  return response;
}
