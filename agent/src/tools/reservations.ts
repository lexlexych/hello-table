import type { AvailableTable } from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { createReservation, findAvailableTables } from "./reservations-db.ts";
import {
  failure,
  resolveToolLanguage,
  type ToolDeps,
  type ToolReply,
  toolLanguageParameter,
} from "./shared.ts";
import { logToolResult } from "./tool-logging.ts";

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
      "und eine Anzahl Gäste. Nach der Gästezahl nur kurz und ohne Ergänzungen, Kategorien " +
      "oder Erklärungen fragen. Liefert freie Tische in einer bevorzugten Reihenfolge mit " +
      "Bereich (z. B. Hauptraum oder Terrasse). Nur bei mehreren verfügbaren Bereichen " +
      "nach dem gewünschten Bereich fragen; niemals einen konkreten Tisch, eine Nummer " +
      "oder eine Bezeichnung vom Gast wählen lassen.",
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
        .describe("Anzahl der Gäste; ohne Zusätze oder Erklärungen erfragen"),
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (args): Promise<ToolReply<{ tables: AvailableTable[] }>> => {
      const startedAt = Date.now();
      const language = resolveToolLanguage(deps, args.language);
      const logInput = {
        date: args.date,
        time: args.time,
        party_size: args.party_size,
        language,
      };
      const outcome = await findAvailableTables(deps.database, {
        restaurant_id: deps.restaurantId,
        date: args.date,
        time: args.time,
        party_size: args.party_size,
      });

      if (!outcome.ok) {
        const reply = failure(deps.session.phrases, outcome.error);
        logToolResult("check_availability", logInput, reply, startedAt);
        return reply;
      }
      const reply = { ok: true as const, tables: outcome.value.tables };
      logToolResult("check_availability", logInput, reply, startedAt);
      return reply;
    },
  });
}

export function createReservationTool(deps: ToolDeps) {
  return llm.tool({
    name: "create_reservation",
    description:
      "Reserviert einen Tisch aus einem vorherigen check_availability — niemals eine ID " +
      "erfinden. Nach der Bereichswahl den ersten Tisch dieses Bereichs in der gelieferten " +
      "Reihenfolge verwenden; ist nur ein Bereich verfügbar oder hat der Gast keine " +
      "Präferenz, den ersten Tisch der Antwort verwenden. Niemals den Gast einen konkreten " +
      "Tisch wählen lassen. Vorher nur den Namen erfragen. Niemals nach der Telefonnummer " +
      "fragen und guest_phone immer null setzen. Die Reservierung erst bestätigen, wenn " +
      "dieses Werkzeug erfolgreich war.",
    parameters: z.object({
      table_id: z
        .string()
        .describe("Tisch-ID aus dem Ergebnis von check_availability"),
      date: z.string().describe("Tag des Besuchs im Format YYYY-MM-DD"),
      time: z.string().describe("Uhrzeit im 24-Stunden-Format HH:MM"),
      party_size: z.number().int().describe("Anzahl der Gäste"),
      guest_name: z.string().describe("Name, unter dem reserviert wird"),
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (
      args,
    ): Promise<
      ToolReply<{
        reservation_id: string;
        table_label: string;
        starts_at: string;
        ends_at: string;
      }>
    > => {
      const startedAt = Date.now();
      const language = resolveToolLanguage(deps, args.language);
      const logInput = {
        table_id: args.table_id,
        date: args.date,
        time: args.time,
        party_size: args.party_size,
        language,
      };
      const outcome = await createReservation(deps.database, {
        restaurant_id: deps.restaurantId,
        table_id: args.table_id,
        date: args.date,
        time: args.time,
        party_size: args.party_size,
        guest_name: args.guest_name,
        // Телефон намеренно не входит в tool-схему LLM: голосовой агент не должен
        // ни запрашивать его, ни передавать придуманное значение.
        guest_phone: null,
        // Язык разговора на момент брони: он попадает в reservations.language и
        // определяет язык подтверждений и уведомлений (PROJECT.md §4.1 п.5).
        language,
      });

      if (!outcome.ok) {
        const reply = failure(deps.session.phrases, outcome.error);
        logToolResult("create_reservation", logInput, reply, startedAt);
        return reply;
      }
      const reply = {
        ok: true,
        reservation_id: outcome.value.reservation_id,
        table_label: outcome.value.table_label,
        starts_at: outcome.value.starts_at,
        ends_at: outcome.value.ends_at,
      } as const;
      logToolResult("create_reservation", logInput, reply, startedAt);
      return reply;
    },
  });
}
