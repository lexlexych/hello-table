import { issueWebsiteCallToken } from "@/lib/livekit";
import { rateLimit, requestKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Публичная выдача токена LiveKit: гость сайта не авторизован, поэтому единственная защита —
 * тот же лимит на IP, что и у формы брони. Токен даёт права только на одну свежую комнату
 * и живёт 15 минут (lib/livekit.ts).
 */
export async function POST(request: Request): Promise<Response> {
  if (!rateLimit(`voice-call:${requestKey(request)}`)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  try {
    return Response.json(await issueWebsiteCallToken());
  } catch (error) {
    // В лог не попадают ни ключи, ни адрес LiveKit — только факт, что конфиг не собрался.
    console.error("website voice call token failed", {
      code: error instanceof Error ? error.name : "unknown",
    });
    return Response.json(
      { ok: false, error: "service_unavailable" },
      { status: 503 },
    );
  }
}
