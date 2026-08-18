import { createHmac } from "node:crypto";
import type { ToolError } from "@hello-table/contracts";
import { log } from "@livekit/agents";
import type { z } from "zod";

/**
 * Единственное место, откуда агент ходит в сеть. Прямого доступа к Postgres у агента нет:
 * каждый инструмент — вебхук n8n, подписанный HMAC (docs/PROJECT.md §3.5).
 */

export interface WebhookClientOptions {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
}

export type WebhookOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: ToolError };

/** Подпись тела запроса: заголовок X-Signature, HMAC-SHA256 в hex. */
export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Ответ вебхука — размеченное объединение по полю `ok`. Успешная ветка описывается
 * схемой инструмента, ветка отказа несёт перечислимый код ошибки.
 */
type ResponseUnion = { ok: true } | { ok: false; error: ToolError };

/**
 * Вызывает вебхук и валидирует ответ схемой ДО того, как результат уйдёт в LLM.
 * Наружу исключения не летят: любой сбой — это типизированный `{ ok: false, error }`,
 * по которому инструмент подберёт фразу на языке разговора.
 *
 * В лог не попадают ни тело запроса, ни тело ответа: там имя и телефон гостя,
 * а персональные данные не логируются (PROJECT.md §0.4).
 */
export async function callWebhook<Schema extends z.ZodType<ResponseUnion>>(
  client: WebhookClientOptions,
  path: string,
  payload: unknown,
  schema: Schema,
): Promise<WebhookOutcome<Extract<z.infer<Schema>, { ok: true }>>> {
  const logger = log().child({ webhook: path });
  const body = JSON.stringify(payload);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(
      `${client.baseUrl.replace(/\/+$/, "")}/webhook/${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": signBody(body, client.secret),
        },
        body,
        signal: AbortSignal.timeout(client.timeoutMs),
      },
    );
  } catch (error) {
    // TimeoutError приходит из AbortSignal.timeout, всё остальное — сеть или DNS.
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const failure: ToolError = timedOut ? "timeout" : "unreachable";
    logger.warn(
      { result: failure, ms: Date.now() - startedAt },
      "webhook call",
    );
    return { ok: false, error: failure };
  }

  if (!response.ok) {
    // Пока workflow n8n не созданы (итерация 5), сюда приходит 404 — и это
    // обрабатывается так же, как недоступность: извинение и обратный звонок.
    logger.warn(
      {
        result: "http_error",
        status: response.status,
        ms: Date.now() - startedAt,
      },
      "webhook call",
    );
    return { ok: false, error: "unreachable" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = await response.json();
  } catch {
    logger.warn({ result: "invalid_response" }, "webhook call");
    return { ok: false, error: "invalid_response" };
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    // Ответ не по контракту нельзя отдавать модели: она начнёт достраивать смысл сама.
    logger.warn({ result: "invalid_response" }, "webhook call");
    return { ok: false, error: "invalid_response" };
  }

  const data = parsed.data;
  if (!data.ok) {
    logger.info(
      { result: data.error, ms: Date.now() - startedAt },
      "webhook call",
    );
    return { ok: false, error: data.error };
  }

  logger.info({ result: "ok", ms: Date.now() - startedAt }, "webhook call");
  return {
    ok: true,
    value: data as Extract<z.infer<Schema>, { ok: true }>,
  };
}

/** Минимум, который нужен инструменту от сессии, чтобы произнести филлер-фразу. */
export interface FillerSpeaker {
  say(
    text: string,
    options?: { addToChatCtx?: boolean; allowInterruptions?: boolean },
  ): unknown;
}

/**
 * Произносит короткую фразу перед сетевым вызовом и только потом уходит в сеть.
 *
 * Это хук в коде, а не строчка в промпте: PROJECT.md §3.3 прямо требует так —
 * модель об этой фразе забудет, и гость будет слушать тишину в течение всего запроса.
 */
export async function withFiller<T>(
  speaker: FillerSpeaker | undefined,
  phrase: string,
  call: () => Promise<T>,
): Promise<T> {
  speaker?.say(phrase, { addToChatCtx: false, allowInterruptions: true });
  return call();
}
