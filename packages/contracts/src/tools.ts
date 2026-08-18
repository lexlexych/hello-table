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
  /** Зона зала: по ней агент спрашивает «в зале или на террасе». */
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
  /** Столик из ответа check_availability. Агент не подбирает его сам. */
  table_id: idSchema,
  date: dateStringSchema,
  time: timeStringSchema,
  party_size: z.int().min(1).max(100),
  guest_name: z.string().trim().min(1),
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

// ── request_callback → callback.create ───────────────────────────────────────

export const requestCallbackRequestSchema = toolEnvelopeSchema.extend({
  category: callbackCategorySchema,
  /** Лимит 400 символов держит и CHECK на callback_requests.summary (§6.2). */
  summary: z.string().trim().min(1).max(400),
  phone: z.string().trim().min(1).nullable(),
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
