/**
 * Тонкая обёртка над fetch для форм справочников. Возвращает либо данные, либо
 * машинный код ошибки — текст подбирает вызывающая страница, потому что он зависит
 * от сущности: «столик участвует в бронях» против «блюдо есть в заказах».
 */

export interface ApiIssue {
  field: string;
  message: string;
}

export interface ApiFailure {
  code: string;
  issues?: ApiIssue[];
}

export type ApiResult<T> =
  | { ok: true; data: T | undefined }
  | { ok: false; failure: ApiFailure };

export async function apiSend<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  }).catch(() => undefined);

  if (!response) {
    return { ok: false, failure: { code: "network" } };
  }

  // 204 на удалении: тела нет и разбирать нечего.
  if (response.status === 204) {
    return { ok: true, data: undefined };
  }

  const payload: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    return { ok: true, data: payload as T };
  }

  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  return {
    ok: false,
    failure: {
      code: typeof record.error === "string" ? record.error : "unknown",
      ...(Array.isArray(record.issues)
        ? { issues: record.issues as ApiIssue[] }
        : {}),
    },
  };
}
