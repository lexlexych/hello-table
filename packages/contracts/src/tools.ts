import { z } from "zod";
import {
  callbackCategorySchema,
  dateStringSchema,
  domainToolErrorSchema,
  idSchema,
  languageSchema,
  timeStringSchema,
} from "./domain.ts";

/**
 * Контракты инструментов и совместимых n8n-входов. Текстовое описание каждого —
 * docs/tool-contracts.md, список инструментов — docs/PROJECT.md §6.
 *
 * Ключи в snake_case: это форма JSON на проводе, а не объект TypeScript. Ответ
 * вебхука — строго типизированная структура без свободного текста: агент передаёт
 * результат в LLM, и непредсказуемый формат заставит модель выдумывать (§3.4).
 */

/** Envelope n8n-входа; прямой агент берёт restaurant_id из конфига и не передаёт session_id. */
export const toolEnvelopeSchema = z.object({
  restaurant_id: idSchema,
  session_id: z.string().min(1),
});

/** Отказ. Причина — перечислимый код, а не сообщение: фразу подбирает агент из i18n. */
export const toolFailureSchema = z.object({
  ok: z.literal(false),
  error: domainToolErrorSchema,
});

// ── check_availability → reservation.check ───────────────────────────────────

export const checkAvailabilityRequestSchema = toolEnvelopeSchema.extend({
  date: dateStringSchema,
  time: timeStringSchema,
  party_size: z.int().min(1).max(100),
});
export type CheckAvailabilityRequest = z.infer<
  typeof checkAvailabilityRequestSchema
>;

export const availableTableSchema = z.object({
  table_id: idSchema,
  label: z.string().min(1),
  seats: z.int().min(1),
  /** Зона зала: агент предлагает зоны, но сам выбирает первый столик нужной зоны. */
  zone: z.string().min(1).nullable(),
});
export type AvailableTable = z.infer<typeof availableTableSchema>;

export const checkAvailabilityResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), tables: z.array(availableTableSchema) }),
  toolFailureSchema,
]);
export type CheckAvailabilityResponse = z.infer<
  typeof checkAvailabilityResponseSchema
>;

// ── create_reservation → reservation.create ──────────────────────────────────

export const createReservationRequestSchema = toolEnvelopeSchema.extend({
  /** Первый подходящий столик нужной зоны из ответа check_availability. */
  table_id: idSchema,
  date: dateStringSchema,
  time: timeStringSchema,
  party_size: z.int().min(1).max(100),
  guest_name: z.string().trim().min(1),
  /** Голосовой агент всегда передаёт null; поле остаётся общим для других каналов. */
  guest_phone: z.string().trim().min(1).nullable(),
  language: languageSchema,
});
export type CreateReservationRequest = z.infer<
  typeof createReservationRequestSchema
>;

export const createReservationResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    reservation_id: idSchema,
    table_label: z.string().min(1),
    starts_at: z.string().min(1),
    ends_at: z.string().min(1),
  }),
  toolFailureSchema,
]);
export type CreateReservationResponse = z.infer<
  typeof createReservationResponseSchema
>;

// ── search_menu → get_current_menu ─────────────────────────────────────────

/** У инструмента нет аргументов от LLM: ресторан берётся из конфига агента. */
export const searchMenuRequestSchema = toolEnvelopeSchema;
export type SearchMenuRequest = z.infer<typeof searchMenuRequestSchema>;

export const menuItemSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1),
  description: z.string().nullable(),
  price_cents: z.int().min(0),
  /** Готовая локализованная цена: LLM не форматирует деньги самостоятельно. */
  price: z.string().trim().min(1),
  allergens: z.array(z.string().trim().min(1)),
  is_vegetarian: z.boolean(),
  is_vegan: z.boolean(),
  weight_g: z.int().positive().nullable(),
  volume_ml: z.int().positive().nullable(),
  kcal: z.int().min(0).nullable(),
  protein_g: z.int().min(0).nullable(),
  fat_g: z.int().min(0).nullable(),
  carbs_g: z.int().min(0).nullable(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const menuCategorySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1),
  items: z.array(menuItemSchema).min(1),
});
export type MenuCategory = z.infer<typeof menuCategorySchema>;

/** Строка прямой Postgres RPC до группировки категорий в агенте. */
export const currentMenuRowSchema = z.object({
  category_id: idSchema,
  category_name: z.string().trim().min(1),
  category_sort_order: z.int(),
  item_id: idSchema,
  item_name: z.string().trim().min(1),
  item_description: z.string().nullable(),
  item_price_cents: z.int().min(0),
  item_allergens: z.array(z.string().trim().min(1)),
  item_is_vegetarian: z.boolean(),
  item_is_vegan: z.boolean(),
  item_weight_g: z.int().positive().nullable(),
  item_volume_ml: z.int().positive().nullable(),
  item_kcal: z.int().min(0).nullable(),
  item_protein_g: z.int().min(0).nullable(),
  item_fat_g: z.int().min(0).nullable(),
  item_carbs_g: z.int().min(0).nullable(),
});
export type CurrentMenuRow = z.infer<typeof currentMenuRowSchema>;

export const searchMenuResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), categories: z.array(menuCategorySchema) }),
  toolFailureSchema,
]);
export type SearchMenuResponse = z.infer<typeof searchMenuResponseSchema>;

// ── check_pickup_slots → find_pickup_slots_local ─────────────────────────────

/**
 * Позиция корзины самовывоза. `menu_item_id` берётся только из результата `search_menu`:
 * отдельного инструмента поиска блюда нет, весь доступный каталог уже в контексте модели.
 */
export const pickupOrderItemSchema = z.object({
  menu_item_id: idSchema,
  quantity: z.int().min(1).max(50),
  /** Пометка вроде «без лука». Отсутствие пожелания — `null`, а не пустая строка. */
  note: z.string().trim().min(1).nullable(),
});
export type PickupOrderItem = z.infer<typeof pickupOrderItemSchema>;

/**
 * Дата и время — местные и необязательные: пустые означают «как можно раньше».
 * Корзина обязательна, потому что время готовности зависит от `prep_minutes` позиций,
 * а их знает только база.
 */
export const checkPickupSlotsRequestSchema = toolEnvelopeSchema.extend({
  items: z.array(pickupOrderItemSchema).min(1),
  date: dateStringSchema.nullable(),
  time: timeStringSchema.nullable(),
});
export type CheckPickupSlotsRequest = z.infer<
  typeof checkPickupSlotsRequestSchema
>;

export const pickupSlotSchema = z.object({
  /** Момент выдачи в ISO. Модель его не произносит — он нужен для сопоставления слота. */
  ready_at: z.string().min(1),
  /** Местная дата ресторана, YYYY-MM-DD: по ней агент отличает сегодня от завтра. */
  date: dateStringSchema,
  /** Местное настенное время, HH:MM. Словами его проговаривает модель по правилам промпта. */
  time: timeStringSchema,
});
export type PickupSlot = z.infer<typeof pickupSlotSchema>;

export const checkPickupSlotsResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), slots: z.array(pickupSlotSchema) }),
  toolFailureSchema,
]);
export type CheckPickupSlotsResponse = z.infer<
  typeof checkPickupSlotsResponseSchema
>;

// ── create_pickup_order → create_pickup_order_local ──────────────────────────

export const createPickupOrderRequestSchema = toolEnvelopeSchema.extend({
  items: z.array(pickupOrderItemSchema).min(1),
  date: dateStringSchema.nullable(),
  time: timeStringSchema.nullable(),
  guest_name: z.string().trim().min(1),
  /** Голосовой агент всегда передаёт null; поле остаётся общим для других каналов. */
  guest_phone: z.string().trim().min(1).nullable(),
  language: languageSchema,
});
export type CreatePickupOrderRequest = z.infer<
  typeof createPickupOrderRequestSchema
>;

export const createPickupOrderResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    order_id: idSchema,
    /** Четыре цифры, которые агент диктует гостю дважды (PROJECT.md §6.1). */
    order_number: z
      .string()
      .regex(/^\d{4}$/, "ожидается номер из четырёх цифр"),
    total_cents: z.int().min(0),
    /** Готовая локализованная сумма: LLM не форматирует деньги самостоятельно. */
    total: z.string().trim().min(1),
    ready_at: z.string().min(1),
    /** Подтверждённое базой время выдачи: оно могло быть округлено вверх до 15 минут. */
    ready_date: dateStringSchema,
    ready_time: timeStringSchema,
  }),
  toolFailureSchema,
]);
export type CreatePickupOrderResponse = z.infer<
  typeof createPickupOrderResponseSchema
>;

// ── request_callback → callback.create ───────────────────────────────────────

export const requestCallbackRequestSchema = toolEnvelopeSchema.extend({
  category: callbackCategorySchema,
  /** Лимит 400 символов держит и CHECK на callback_requests.summary (§6.2). */
  summary: z.string().trim().min(1).max(400),
  /** Подтверждённый гостем телефон; голосовой запрос без контакта не создаётся. */
  phone: z.string().trim().min(3).max(40),
  language: languageSchema,
});
export type RequestCallbackRequest = z.infer<
  typeof requestCallbackRequestSchema
>;

export const requestCallbackResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), callback_id: idSchema }),
  toolFailureSchema,
]);
export type RequestCallbackResponse = z.infer<
  typeof requestCallbackResponseSchema
>;

/**
 * Пути сохранённых workflow n8n для чата и формуляров. Голосовой агент их не вызывает.
 */
export const WEBHOOK_PATHS = {
  check_availability: "reservation.check",
  create_reservation: "reservation.create",
  request_callback: "callback.create",
} as const;
export type ToolName = keyof typeof WEBHOOK_PATHS;
