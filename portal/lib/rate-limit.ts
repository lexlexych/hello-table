/**
 * Ограничение попыток входа (PROJECT.md §7.1: 5 попыток на IP за 15 минут).
 *
 * Счётчик живёт в памяти процесса. Для одного инстанса портала этого достаточно;
 * при нескольких репликах понадобится общее хранилище — ограничение известное и
 * записано в спеке 004.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_ATTEMPTS = 5;

interface Window {
  count: number;
  startedAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitVerdict {
  allowed: boolean;
  /** Сколько секунд ждать до следующей попытки; 0, если попытка разрешена. */
  retryAfterSeconds: number;
}

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (now - window.startedAt >= LOGIN_WINDOW_MS) {
      windows.delete(key);
    }
  }
}

/** Учитывает одну попытку входа и говорит, разрешена ли она. */
export function consumeLoginAttempt(
  key: string,
  now: number = Date.now(),
): RateLimitVerdict {
  prune(now);

  const window = windows.get(key);
  if (!window) {
    windows.set(key, { count: 1, startedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (window.count >= LOGIN_MAX_ATTEMPTS) {
    const elapsed = now - window.startedAt;
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((LOGIN_WINDOW_MS - elapsed) / 1000),
    };
  }

  window.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Успешный вход обнуляет счётчик, чтобы обычная работа никогда не упиралась в лимит. */
export function clearLoginAttempts(key: string): void {
  windows.delete(key);
}

/** Только для тестов. */
export function resetRateLimit(): void {
  windows.clear();
}

/**
 * Ключ ограничения. Локально заголовков прокси нет и все попытки считаются общими;
 * за Caddy (итерация 12) `x-forwarded-for` выставляет сам прокси. Доверять заголовку
 * можно только потому, что портал наружу публикуется исключительно через него.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || "local";
}
