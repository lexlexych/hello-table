import {
  type AvailableTable,
} from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { createReservation, findAvailableTables } from "./reservations-db.ts";
import {
  callWithVoiceMode,
  failure,
  resolveToolLanguage,
  toolLanguageParameter,
  type ToolDeps,
  type ToolReply,
} from "./shared.ts";

/**
 * Инструменты бронирования. Порядок задан структурой, а не только промптом:
 * `create_reservation` требует `table_id`, а взять его можно только из ответа
 * `check_availability`.
 */

export function checkAvailabilityTool(deps: ToolDeps) {
  return llm.tool({
    name: "check_availability",
    description:
      "Sucht freie Tische im Restaurant für einen konkreten Tag, eine konkrete Uhrzeit " +
      "und eine Anzahl Gäste. Vorher Tag, Uhrzeit und Gästezahl beim Gast erfragen. " +
      "Liefert die freien Tische mit Bereich (z. B. Hauptraum oder Terrasse); bei mehreren " +
      "Bereichen den Gast nach seinem Wunsch fragen und nicht selbst wählen.",
    parameters: z.object({
      date: z
        .string()
        .describe(
          "Tag des Besuchs im Format YYYY-MM-DD, Ortszeit des Restaurants",
        ),
      time: z
        .string()
        .describe("Gewünschte Uhrzeit im 24-Stunden-Format HH:MM, z. B. 19:30"),
      party_size: z
        .number()
        .int()
        .describe("Anzahl der Gäste, inklusive Kinder"),
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (
      args,
      opts,
    ): Promise<ToolReply<{ tables: AvailableTable[] }>> => {
      resolveToolLanguage(deps, args.language);
      const outcome = await callWithVoiceMode(
        deps,
        opts.ctx.session,
        deps.session.phrases.filler_checking,
        () =>
          findAvailableTables(deps.database, {
            restaurant_id: deps.restaurantId,
            date: args.date,
            time: args.time,
            party_size: args.party_size,
          }),
      );

      if (!outcome.ok) return failure(deps.session.phrases, outcome.error);
      return { ok: true, tables: outcome.value.tables };
    },
  });
}

export function createReservationTool(deps: ToolDeps) {
  return llm.tool({
    name: "create_reservation",
    description:
      "Reserviert genau den Tisch, den der Gast gewählt hat. Nur mit einer table_id aus " +
      "einem vorherigen check_availability aufrufen — niemals eine ID erfinden. Vorher " +
      "Namen und Telefonnummer erfragen. Die Reservierung erst bestätigen, wenn dieses " +
      "Werkzeug erfolgreich war.",
    parameters: z.object({
      table_id: z
        .string()
        .describe("Tisch-ID aus dem Ergebnis von check_availability"),
      date: z.string().describe("Tag des Besuchs im Format YYYY-MM-DD"),
      time: z.string().describe("Uhrzeit im 24-Stunden-Format HH:MM"),
      party_size: z.number().int().describe("Anzahl der Gäste"),
      guest_name: z.string().describe("Name, unter dem reserviert wird"),
      guest_phone: z
        .string()
        .nullable()
        .describe("Telefonnummer des Gastes oder null, wenn nicht genannt"),
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (
      args,
      opts,
    ): Promise<
      ToolReply<{
        reservation_id: string;
        table_label: string;
        starts_at: string;
        ends_at: string;
      }>
    > => {
      const language = resolveToolLanguage(deps, args.language);
      const outcome = await callWithVoiceMode(
        deps,
        opts.ctx.session,
        deps.session.phrases.filler_booking,
        () =>
          createReservation(deps.database, {
            restaurant_id: deps.restaurantId,
            table_id: args.table_id,
            date: args.date,
            time: args.time,
            party_size: args.party_size,
            guest_name: args.guest_name,
            guest_phone: args.guest_phone,
            // Язык разговора на момент брони: он попадает в reservations.language и
            // определяет язык подтверждений и уведомлений (PROJECT.md §4.1 п.5).
            language,
          }),
      );

      if (!outcome.ok) return failure(deps.session.phrases, outcome.error);
      return {
        ok: true,
        reservation_id: outcome.value.reservation_id,
        table_label: outcome.value.table_label,
        starts_at: outcome.value.starts_at,
        ends_at: outcome.value.ends_at,
      };
    },
  });
}
