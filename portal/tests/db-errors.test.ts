import { describe, expect, it } from "vitest";
import { toDbErrorCode } from "@/lib/db-errors";

/**
 * Портал не пересказывает пользователю текст ошибки Postgres — он переводит SQLSTATE
 * в код. Неизвестный код обязан остаться неизвестным: маршрут превратит его в 500,
 * а не в бодрое «сохранено».
 */
describe("перевод ошибок базы", () => {
  it("узнаёт нарушение уникальности", () => {
    expect(toDbErrorCode({ code: "23505" })).toBe("duplicate");
  });

  it("узнаёт отказ ON DELETE RESTRICT", () => {
    // Postgres поднимает 23001 (restrict_violation), а не 23503 — это подтверждено
    // интеграционными тестами в portal/tests/db.
    expect(toDbErrorCode({ code: "23001" })).toBe("in_use");
    expect(toDbErrorCode({ code: "23503" })).toBe("in_use");
  });

  it("узнаёт нарушение CHECK", () => {
    expect(toDbErrorCode({ code: "23514" })).toBe("invalid");
  });

  it("не выдумывает код для незнакомой ошибки", () => {
    expect(toDbErrorCode({ code: "42501" })).toBeUndefined();
    expect(toDbErrorCode(new Error("соединение оборвалось"))).toBeUndefined();
    expect(toDbErrorCode(undefined)).toBeUndefined();
    expect(toDbErrorCode("23505")).toBeUndefined();
  });
});
