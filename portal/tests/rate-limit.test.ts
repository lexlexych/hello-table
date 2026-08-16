import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginAttempts,
  clientKey,
  consumeLoginAttempt,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  resetRateLimit,
} from "@/lib/rate-limit";

describe("ограничение попыток входа", () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it("разрешает пять попыток и отклоняет шестую", () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
      expect(consumeLoginAttempt("1.2.3.4", now).allowed).toBe(true);
    }

    const verdict = consumeLoginAttempt("1.2.3.4", now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(LOGIN_WINDOW_MS / 1000);
  });

  it("считает адреса раздельно", () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS + 1; attempt += 1) {
      consumeLoginAttempt("1.2.3.4", now);
    }
    expect(consumeLoginAttempt("5.6.7.8", now).allowed).toBe(true);
  });

  it("открывает новое окно, когда прежнее истекло", () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS + 1; attempt += 1) {
      consumeLoginAttempt("1.2.3.4", now);
    }
    expect(consumeLoginAttempt("1.2.3.4", now).allowed).toBe(false);
    expect(consumeLoginAttempt("1.2.3.4", now + LOGIN_WINDOW_MS).allowed).toBe(
      true,
    );
  });

  it("успешный вход обнуляет счётчик", () => {
    const now = 1_000_000;
    for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt += 1) {
      consumeLoginAttempt("1.2.3.4", now);
    }
    clearLoginAttempts("1.2.3.4");
    expect(consumeLoginAttempt("1.2.3.4", now).allowed).toBe(true);
  });

  it("берёт первый адрес из x-forwarded-for", () => {
    expect(
      clientKey(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })),
    ).toBe("203.0.113.5");
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
    expect(clientKey(new Headers())).toBe("local");
  });
});
