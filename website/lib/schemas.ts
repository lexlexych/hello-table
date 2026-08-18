import { z } from "zod";
import { languages } from "./menu";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const realDate = z.string().regex(datePattern).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});

export const availabilityRequestSchema = z.object({
  date: realDate,
  time: z.string().regex(timePattern),
  party_size: z.number().int().min(1).max(8),
});

export const reservationRequestSchema = availabilityRequestSchema.extend({
  table_id: z.string().regex(uuidPattern),
  guest_name: z.string().trim().min(2).max(100),
  guest_phone: z.string().trim().min(5).max(40),
  language: z.enum(languages),
  privacy_accepted: z.literal(true),
});

export const tableSchema = z.object({
  table_id: z.string().regex(uuidPattern),
  label: z.string().min(1),
  seats: z.number().int().positive(),
  zone: z.string().min(1),
});

export const availabilityResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), tables: z.array(tableSchema) }),
  z.object({
    ok: z.literal(false),
    error: z.enum(["restaurant_not_found", "invalid_request"]),
  }),
]);

export const reservationResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    reservation_id: z.string().regex(uuidPattern),
    table_label: z.string().min(1),
    starts_at: z.string(),
    ends_at: z.string(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.enum([
      "restaurant_not_found",
      "closed_at_requested_time",
      "party_too_large",
      "slot_in_past",
      "table_not_available",
      "table_already_booked",
      "invalid_request",
    ]),
  }),
]);

export type AvailabilityRequest = z.infer<typeof availabilityRequestSchema>;
export type ReservationRequest = z.infer<typeof reservationRequestSchema>;
export type AvailableTable = z.infer<typeof tableSchema>;
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
export type ReservationResponse = z.infer<typeof reservationResponseSchema>;
