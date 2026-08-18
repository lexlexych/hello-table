import { z } from "zod";

/**
 * Границы повторяют CHECK из `db/migrations/002_restaurants_and_tables.sql`.
 * Это не замена проверкам базы, а способ показать ошибку в форме до похода в базу:
 * последнее слово всё равно за Postgres.
 *
 * Схема одна на создание и на изменение — форма всегда отправляет столик целиком.
 * Частичный PATCH сознательно не поддерживается: он размывает валидацию и не нужен,
 * пока единственный клиент — эта же форма.
 */

const trimmed = z.string().trim();

/** Пустая строка в необязательном поле означает «значения нет», а не «сохранить пустоту». */
const optionalText = (max: number) =>
  trimmed
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

export const tableInputSchema = z.object({
  label: trimmed.min(1, "Укажите метку").max(40),
  seats: z.int().min(1).max(50),
  zone: optionalText(60),
  isActive: z.boolean(),
  combinable: z.boolean(),
});

export type TableInput = z.infer<typeof tableInputSchema>;
