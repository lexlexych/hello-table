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
 * Контракты вебхуков n8n. Текстовое описание каждого — docs/tool-contracts.md,
 * список инструментов — docs/PROJECT.md §6.
 *
 * Ключи в snake_case: это форма JSON на проводе, а не объект TypeScript. Ответ
 * вебхука — строго типизированная структура без свободного текста: агент передаёт
 * результат в LLM, и непредсказуемый формат заставит модель выдумывать (§3.4).
 */

/** Поля, которые несёт каждый запрос к любому инструменту (PROJECT.md §3.5). */
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
 * Пути вебхуков из PROJECT.md §6. Клиент собирает адрес как
 * `${N8N_BASE_URL}/webhook/${WEBHOOK_PATHS.check_availability}`.
 */
export const WEBHOOK_PATHS = {
  check_availability: "reservation.check",
  create_reservation: "reservation.create",
  request_callback: "callback.create",
} as const;
export type ToolName = keyof typeof WEBHOOK_PATHS;
