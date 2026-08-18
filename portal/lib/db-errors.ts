/**
 * Ошибки Postgres → машинные коды для клиента. Тексты живут на клиенте и зависят от
 * сущности («столик участвует в бронях» против «блюдо есть в заказах»), поэтому здесь
 * только код. Всё, что не распознано, отдаётся как `unknown` и превращается в 500:
 * молча показывать «сохранено» при неизвестной ошибке нельзя.
 */

export const DB_ERROR_CODES = ["duplicate", "in_use", "invalid"] as const;
export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

const BY_SQLSTATE: Record<string, DbErrorCode> = {
  "23505": "duplicate", // unique_violation — метка столика, немецкое имя категории
  // ON DELETE RESTRICT поднимает именно restrict_violation (23001), а не 23503:
  // проверка срабатывает сразу, не откладываясь до конца транзакции.
  "23001": "in_use",
  "23503": "in_use", // foreign_key_violation — ссылка на несуществующую строку
  "23514": "invalid", // check_violation — сюда доходит только то, что пропустил zod
  "22001": "invalid", // string_data_right_truncation
};

export function toDbErrorCode(error: unknown): DbErrorCode | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? BY_SQLSTATE[code] : undefined;
}
