import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { PORTAL_LOCALES } from "@/lib/i18n/catalog";
import {
  PORTAL_LOCALE_COOKIE,
  portalLocaleCookieOptions,
} from "@/lib/i18n/server";
import { guardRequest } from "@/lib/rbac";

const bodySchema = z.object({ locale: z.enum(PORTAL_LOCALES) });

export async function PATCH(request: NextRequest) {
  const guard = await guardRequest(request, ["admin"]);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? "unauthorized" : "forbidden" },
      { status: guard.status },
    );
  }
  const body = bodySchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!body.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const response = NextResponse.json({ locale: body.data.locale });
  response.cookies.set(
    PORTAL_LOCALE_COOKIE,
    body.data.locale,
    portalLocaleCookieOptions(getConfig().PORTAL_COOKIE_SECURE),
  );
  return response;
}
