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

/**
 * Дневная бронь столика (PROJECT.md §7.3). Столик приходит адресом маршрута, поэтому
 * в теле его нет. Дата и время — строки, а не `Date`: часовой пояс ресторана знает
 * только база, и превращать местное «18:30» в момент времени должна она
 * (`book_table_for_day`), а не браузер оператора.
 */
export const tableBookingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ"),
  guestName: trimmed.min(1, "Укажите имя гостя").max(120),
  // Верхняя граница — CHECK таблицы reservations. max_party_size здесь намеренно не
  // применяется: это лимит телефонных броней, а столик выбирает человек.
  partySize: z.int().min(1).max(100),
});

export type TableBookingInput = z.infer<typeof tableBookingSchema>;
