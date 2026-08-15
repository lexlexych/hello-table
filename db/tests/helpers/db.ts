/**
 * Адрес тестовой базы. Значение выставляет global-setup, который пересоздаёт
 * restaurant_test и накатывает миграции. Файлы тестов .env не читают никогда
 * (AGENTS.md §4) — только эту переменную.
 */
/**
 * Разворачивает значение, которое по типам может отсутствовать.
 * Нужно из-за noUncheckedIndexedAccess: деструктуризация первой строки
 * результата даёт `T | undefined`, а подставлять такое в SQL нельзя.
 * Явная проверка вместо `!` — при поломке фикстуры тест скажет, чего не хватило.
 */
export function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) {
    throw new Error(`фикстура не вернула значение: ${what}`);
  }
  return value;
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set — запускай тесты через `pnpm test`, global-setup выставляет её сам",
    );
  }
  return url;
}
