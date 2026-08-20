import { z } from "zod";

/**
 * Общие типы предметной области: язык разговора, категории обратного звонка и коды
 * ошибок инструментов. Единственный источник истины — дублировать эти списки
 * в агенте или портале запрещено (AGENTS.md §5).
 */

export const LANGUAGES = ["de", "ru", "en"] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

/** Голосовой движок ресторана; совпадает с CHECK restaurants.voice_mode. */
export const VOICE_MODES = ["pipeline", "realtime"] as const;
export const voiceModeSchema = z.enum(VOICE_MODES);
export type VoiceMode = z.infer<typeof voiceModeSchema>;

/**
 * Совпадает с CHECK pickup_orders.status. Порядок значим: в этом же порядке идут
 * колонки канбан-доски портала и по нему считается «следующий» и «предыдущий» статус.
 */
export const PICKUP_ORDER_STATUSES = [
  "new",
  "confirmed",
  "preparing",
  "ready",
  "picked_up",
  "cancelled",
] as const;
export const pickupOrderStatusSchema = z.enum(PICKUP_ORDER_STATUSES);
export type PickupOrderStatus = z.infer<typeof pickupOrderStatusSchema>;

/** Совпадает с CHECK на callback_requests.category. */
export const CALLBACK_CATEGORIES = [
  "banquet",
  "complaint",
  "special",
  "other",
] as const;
export const callbackCategorySchema = z.enum(CALLBACK_CATEGORIES);
export type CallbackCategory = z.infer<typeof callbackCategorySchema>;

/** Совпадает с CHECK callback_requests.status; порядок используется доской сообщений. */
export const CALLBACK_REQUEST_STATUSES = [
  "new",
  "in_progress",
  "done",
] as const;
export const callbackRequestStatusSchema = z.enum(CALLBACK_REQUEST_STATUSES);
export type CallbackRequestStatus = z.infer<
  typeof callbackRequestStatusSchema
>;

/** Канал создания и вид сохранённого контакта в callback_requests. */
export const CALLBACK_REQUEST_SOURCES = ["voice", "telegram"] as const;
export const callbackRequestSourceSchema = z.enum(CALLBACK_REQUEST_SOURCES);
export type CallbackRequestSource = z.infer<
  typeof callbackRequestSourceSchema
>;

export const CALLBACK_CONTACT_KINDS = ["phone", "telegram_id"] as const;
export const callbackContactKindSchema = z.enum(CALLBACK_CONTACT_KINDS);
export type CallbackContactKind = z.infer<typeof callbackContactKindSchema>;

/**
 * Доменные ошибки инструментов. Имена совпадают с прикладными SQLSTATE из
 * db/README.md; прямой клиент агента переводит SQLSTATE в этот enum. `invalid_request`
 * остаётся для n8n-входов из чата и формуляров, не прошедших валидацию.
 */
export const DOMAIN_TOOL_ERRORS = [
  "restaurant_not_found",
  "no_table_available",
  "table_not_available",
  "table_already_booked",
  "closed_at_requested_time",
  "party_too_large",
  "slot_in_past",
  // Самовывоз: слот выдачи занят, позиции нет в доступном меню, пустая или
  // неправдоподобная корзина, свободных слотов до закрытия не осталось, названное
  // время наступает раньше, чем кухня успеет приготовить.
  "slot_full",
  "item_unavailable",
  "empty_order",
  "invalid_quantity",
  "no_pickup_slot",
  "pickup_too_early",
  "order_number_exhausted",
  "phone_required",
  "invalid_category",
  "summary_too_long",
  "invalid_request",
] as const;
export const domainToolErrorSchema = z.enum(DOMAIN_TOOL_ERRORS);
export type DomainToolError = z.infer<typeof domainToolErrorSchema>;

/**
 * Ошибки транспорта. Их формирует агент: база недоступна, превысила таймаут либо
 * вернула результат не по контракту.
 */
export const TRANSPORT_TOOL_ERRORS = [
  "timeout",
  "unreachable",
  "invalid_response",
] as const;
export type TransportToolError = (typeof TRANSPORT_TOOL_ERRORS)[number];

export type ToolError = DomainToolError | TransportToolError;

/** YYYY-MM-DD — календарная дата визита в местном времени ресторана. */
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ожидается дата в формате YYYY-MM-DD");

/** HH:MM — настенное время ресторана. Секунды в разговоре не нужны. */
export const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "ожидается время в формате HH:MM");

/**
 * Идентификаторы проверяются формой строки, а не `z.uuid()`: zod 4 требует биты версии
 * по RFC 9562, а идентификаторы демо-данных в db/seed.sql рукописные
 * (`10000000-0000-…`) и такую проверку не проходят (docs/architecture.md).
 */
export const idSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "ожидается идентификатор в формате UUID",
  );
