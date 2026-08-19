import { pickupOrderStatusSchema } from "@hello-table/contracts";
import { z } from "zod";

/**
 * Заказ на самовывоз, созданный человеком в портале. Границы повторяют CHECK из
 * `db/migrations/004_operations.sql`, а сетку времени — `pickup_slot_is_free`.
 *
 * Заказ целиком собирает Postgres (`create_pickup_order_atomic`): она считает сумму,
 * фиксирует цены позиций и выдаёт четырёхзначный номер. Здесь только то, что вводит
 * оператор, и ровно в том виде, в каком это уйдёт в RPC.
 */

const trimmed = z.string().trim();

/** Пустая строка в необязательном поле означает «значения нет», а не «сохранить пустоту». */
const optionalText = (max: number) =>
  trimmed
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/** Статус заказа. Единственный источник списка — `packages/contracts` (AGENTS.md §5). */
export const pickupStatusSchema = pickupOrderStatusSchema;

export const pickupOrderItemSchema = z.object({
  // `z.guid()`, а не `z.uuid()`: в базе лежат рукописные идентификаторы из `db/seed.sql`,
  // не проходящие проверку битов версии RFC 9562 (та же причина, что в schemas/menu.ts).
  menuItemId: z.guid(),
  quantity: z.int().min(1).max(50),
  note: optionalText(200),
});

export type PickupOrderItemInput = z.infer<typeof pickupOrderItemSchema>;

export const pickupOrderInputSchema = z.object({
  /**
   * Время выдачи — местное настенное время ресторана. Строка, а не `Date`: часовой пояс
   * знает только база, и превращать «18:30» в момент времени должна она.
   *
   * Кратность пятнадцати минутам — не украшение формы, а требование
   * `pickup_slot_is_free`: слот вне сетки она отвергает, и оператор получил бы
   * невнятный `slot_full` вместо подсказки.
   */
  time: trimmed
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ")
    .refine((value) => Number(value.slice(3)) % 15 === 0, {
      message: "Время выдачи кратно 15 минутам: 00, 15, 30 или 45",
    }),
  guestName: trimmed.min(1, "Укажите имя гостя").max(120),
  guestPhone: optionalText(40),
  // Верхняя граница массива — защита от случайной отправки мусора; количество в строке
  // ограничено CHECK(quantity BETWEEN 1 AND 50) таблицы pickup_order_items.
  items: z
    .array(pickupOrderItemSchema)
    .min(1, "Добавьте хотя бы одно блюдо")
    .max(50),
});

export type PickupOrderInput = z.infer<typeof pickupOrderInputSchema>;

export const pickupStatusInputSchema = z.object({
  status: pickupStatusSchema,
});

export type PickupStatusInput = z.infer<typeof pickupStatusInputSchema>;

/**
 * Машинный код ответа → текст для оператора. Живёт рядом со схемами, как
 * `ALLERGEN_LABELS`: словарь нужен и доске, и форме создания заказа.
 */
export const PICKUP_MESSAGES: Record<string, string> = {
  slot_full:
    "Это время недоступно: слот заполнен, ресторан закрыт или время не кратно 15 минутам.",
  pickup_too_early: "Слишком рано: кухне нужно время на приготовление.",
  no_pickup_slot: "На сегодня свободных слотов выдачи не осталось.",
  item_unavailable: "Одно из блюд недоступно. Обновите страницу.",
  empty_order: "В заказе нет ни одного блюда.",
  invalid_quantity: "Количество должно быть целым числом от 1 до 50.",
  order_number_exhausted:
    "База не смогла подобрать свободный номер заказа. Повторите попытку.",
  restaurant_not_found: "Ресторан не найден. Проверьте настройку портала.",
  duplicate: "Номер заказа занят другим активным заказом. Обновите страницу.",
  invalid: "База отвергла значения. Проверьте поля.",
  invalid_body: "Проверьте заполнение полей.",
  not_found: "Заказ уже изменён кем-то другим. Обновите страницу.",
  forbidden: "Недостаточно прав.",
  unauthorized: "Сессия истекла. Войдите заново.",
  network: "Сервер недоступен. Проверьте соединение.",
};

/** Русские подписи колонок доски. Порядок задаёт `PICKUP_ORDER_STATUSES`. */
export const PICKUP_STATUS_LABELS: Record<
  z.infer<typeof pickupStatusSchema>,
  string
> = {
  new: "Новые",
  confirmed: "Подтверждены",
  preparing: "Готовятся",
  ready: "Готовы к выдаче",
  picked_up: "Забраны",
  cancelled: "Отменены",
};
