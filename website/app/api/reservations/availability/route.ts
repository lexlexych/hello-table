import { databaseErrorCode, findAvailableTables, getWebsiteDatabase } from "@/lib/database";
import { getWebsiteConfig } from "@/lib/config";
import { rateLimit, requestKey } from "@/lib/rate-limit";
import { availabilityRequestSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!rateLimit(`availability:${requestKey(request)}`)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const input = availabilityRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  try {
    const config = getWebsiteConfig();
    return Response.json(
      await findAvailableTables(getWebsiteDatabase(), config.restaurantId, input.data),
    );
  } catch (error) {
    console.error("website availability failed", {
      code: databaseErrorCode(error) ?? "configuration_or_database",
    });
    return Response.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }
}
