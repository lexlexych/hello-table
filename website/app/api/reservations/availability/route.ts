import { checkAvailability } from "@/lib/n8n-client";
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
    return Response.json(await checkAvailability(input.data));
  } catch {
    return Response.json({ ok: false, error: "service_unavailable" }, { status: 503 });
  }
}
