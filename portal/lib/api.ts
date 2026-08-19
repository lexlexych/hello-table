import { type NextRequest, NextResponse } from "next/server";
import type postgres from "postgres";
import type { z } from "zod";
import { db } from "./db";
import { toAppErrorCode, toDbErrorCode } from "./db-errors";
import { guardRequest } from "./rbac";
import { getRestaurantId } from "./restaurant";
import type { PortalRole } from "./session";

/**
 * Общая обвязка маршрутов записи справочников. Все они устроены одинаково:
 * проверка роли → разбор тела → запрос в базу → перевод ошибки Postgres в код.
 *
 * Проверка роли здесь независима от того, что отрисовала страница (PROJECT.md §7.2):
 * оператор, отправивший запрос руками, получает 403, хотя кнопки он не видел.
 */

export interface WriteContext {
  sql: postgres.Sql;
  restaurantId: string;
}

/** Проверка роли для маршрута записи; ответ уже готов, если доступа нет. */
export async function requireRole(
  request: NextRequest,
  roles: readonly PortalRole[],
): Promise<NextResponse | undefined> {
  const guard = await guardRequest(request, roles);
  if (guard.ok) {
    return undefined;
  }
  return NextResponse.json(
    { error: guard.status === 401 ? "unauthorized" : "forbidden" },
    { status: guard.status },
  );
}

/** Справочники (столики, меню) правит только администратор — PROJECT.md §7.2. */
export async function requireAdmin(
  request: NextRequest,
): Promise<NextResponse | undefined> {
  return requireRole(request, ["admin"]);
}

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

/**
 * Разбор тела по zod-схеме. Наружу уходят только пути полей и тексты правил —
 * присланных значений в ответе нет, чтобы ошибка не пересказывала запрос.
 */
export async function parseBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<Parsed<T>> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "invalid_body",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    ),
  };
}

/** Соединение и ресторан, с которыми работает этот экземпляр портала. */
export async function writeContext(): Promise<WriteContext> {
  const sql = db();
  return { sql, restaurantId: await getRestaurantId(sql) };
}

export const NOT_FOUND = () =>
  NextResponse.json({ error: "not_found" }, { status: 404 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Идентификатор из пути. Не-uuid отсекается здесь: иначе Postgres поднял бы 22P02,
 * и «мусор в адресе» выглядел бы как внутренняя ошибка портала.
 */
export function readId(value: string): string | undefined {
  return UUID.test(value) ? value : undefined;
}

/**
 * Единственное место, где ошибка базы превращается в ответ. `duplicate` и `in_use` —
 * это конфликт состояния (409), а не ошибка клиента: тело запроса было корректным.
 */
export function dbFailure(error: unknown): NextResponse {
  const code = toDbErrorCode(error);
  if (code === "duplicate" || code === "in_use") {
    return NextResponse.json({ error: code }, { status: 409 });
  }
  if (code === "invalid") {
    return NextResponse.json({ error: code }, { status: 400 });
  }
  // Неизвестная ошибка — это дефект, а не пользовательская ситуация: пусть будет видно
  // в логах сервера. Наружу уходит только «internal_error», без текста Postgres.
  console.error("portal: неожиданная ошибка базы", error);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/**
 * Отказ доменной функции Postgres. `table_already_booked` и `slot_full` — конфликты
 * состояния (409): запрос был корректен, просто столик или слот выдачи успели занять.
 * Остальное клиент прислал сам, поэтому 400. Всё, что не доменное, уходит в
 * `dbFailure` и может стать 500.
 */
const CONFLICT_CODES = new Set(["table_already_booked", "slot_full"]);

export function appFailure(error: unknown): NextResponse {
  const code = toAppErrorCode(error);
  if (code && CONFLICT_CODES.has(code)) {
    return NextResponse.json({ error: code }, { status: 409 });
  }
  if (code) {
    return NextResponse.json({ error: code }, { status: 400 });
  }
  return dbFailure(error);
}
