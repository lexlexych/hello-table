import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getConfig } from "./config";
import { toAppErrorCode, toDbErrorCode } from "./db-errors";

export type ParsedN8nBody<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Машинный API не использует cookie портала. Сравниваем хеши одинаковой длины,
 * чтобы время ответа не зависело от совпавшего префикса или длины присланного ключа.
 */
export function isAuthorizedN8nRequest(request: Request): boolean {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    return false;
  }
  return timingSafeEqual(
    digest(match[1]),
    digest(getConfig().PORTAL_N8N_API_KEY),
  );
}

export function n8nUnauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

/** Невалидный tool input — штатный машинный отказ, а не свободный текст zod. */
export async function parseN8nBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParsedN8nBody<T>> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    response: NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 200 },
    ),
  };
}

const INVALID_REQUEST_SQLSTATES = new Set(["22007", "22008", "22P02", "23514"]);

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : undefined;
}

/**
 * Доменный SQLSTATE возвращается tool-workflow как HTTP 200 envelope. Неизвестная
 * ошибка остаётся 500; в лог не попадает сам объект postgres.js с возможными PII.
 */
export function n8nToolFailure(error: unknown): NextResponse {
  const appCode = toAppErrorCode(error);
  if (appCode) {
    return NextResponse.json({ ok: false, error: appCode }, { status: 200 });
  }

  const code = errorCode(error);
  if (code && INVALID_REQUEST_SQLSTATES.has(code)) {
    return NextResponse.json(
      { ok: false, error: "invalid_request" },
      { status: 200 },
    );
  }

  // Ограничения, не являющиеся прикладным отказом RPC, не раскрываем наружу.
  const dbCode = toDbErrorCode(error);
  console.error("portal n8n api: unexpected database failure", {
    code: code ?? dbCode ?? "unknown",
  });
  return NextResponse.json(
    { ok: false, error: "unreachable" },
    { status: 500 },
  );
}
