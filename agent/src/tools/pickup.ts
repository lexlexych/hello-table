import type { PickupSlot } from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { createPickupOrder, findPickupSlots } from "./pickup-db.ts";
import {
  failure,
  resolveToolLanguage,
  type ToolDeps,
  type ToolReply,
  toolLanguageParameter,
} from "./shared.ts";
import { logToolResult } from "./tool-logging.ts";

/**
 * Инструменты самовывоза. Порядок задан структурой, как и у брони: корзину нельзя
 * собрать, не получив `menu_item_id` из `search_menu`, а время готовности считает база,
 * а не модель (PROJECT.md §6.1).
 */

const pickupItemsParameter = z
  .array(
    z.object({
      menu_item_id: z
        .string()
        .describe("Gericht-ID aus dem Ergebnis von search_menu"),
      quantity: z.number().int().describe("Anzahl der Portionen, 1 bis 50"),
      note: z
        .string()
        .optional()
        .describe("Wunsch des Gastes zu dieser Position, etwa „ohne Zwiebeln“"),
    }),
  )
  .describe(
    "Alle bestellten Positionen. IDs ausschließlich aus search_menu übernehmen und " +
      "niemals erfinden; bei mehreren ähnlichen Treffern beim Gast nachfragen.",
  );

const pickupDateParameter = z
  .string()
  .optional()
  .describe(
    "Gewünschter Abholtag im Format YYYY-MM-DD, Ortszeit des Restaurants. Weglassen, " +
      "wenn der Gast heute abholt oder keinen Tag genannt hat.",
  );

const pickupTimeParameter = z
  .string()
  .optional()
  .describe(
    "Gewünschte Abholzeit im 24-Stunden-Format HH:MM. Weglassen, wenn der Gast keine " +
      "Zeit genannt hat — dann liefert das Restaurant den frühestmöglichen Termin.",
  );

export function checkPickupSlotsTool(deps: ToolDeps) {
  return llm.tool({
    name: "check_pickup_slots",
    description:
      "Liefert genau die früheste mögliche Abholzeit für eine bereits zusammengestellte " +
      "Bestellung. Die " +
      "Zubereitungszeit berechnet das Restaurant selbst — niemals eine Abholzeit schätzen " +
      "oder aus dem Gedächtnis nennen. Vor create_pickup_order aufrufen und dem Gast die " +
      "gelieferte Zeit anbieten.",
    parameters: z.object({
      items: pickupItemsParameter,
      date: pickupDateParameter,
      time: pickupTimeParameter,
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (args): Promise<ToolReply<{ slots: PickupSlot[] }>> => {
      const startedAt = Date.now();
      const language = resolveToolLanguage(deps, args.language);
      const logInput = {
        items: args.items.map((item) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
        })),
        date: args.date ?? null,
        time: args.time ?? null,
        language,
      };
      const outcome = await findPickupSlots(deps.database, {
        restaurant_id: deps.restaurantId,
        items: args.items.map((item) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
          note: item.note ?? null,
        })),
        date: args.date ?? null,
        time: args.time ?? null,
      });

      if (!outcome.ok) {
        const reply = failure(deps.session.phrases, outcome.error);
        logToolResult("check_pickup_slots", logInput, reply, startedAt);
        return reply;
      }
      const reply = { ok: true as const, slots: outcome.value.slots };
      logToolResult("check_pickup_slots", logInput, reply, startedAt);
      return reply;
    },
  });
}

export function createPickupOrderTool(deps: ToolDeps) {
  return llm.tool({
    name: "create_pickup_order",
    description:
      "Legt eine Abholbestellung an. Erst aufrufen, nachdem die Positionen mit Menge und " +
      "der Gesamtbetrag dem Gast vorgelesen und von ihm bestätigt wurden und der Name " +
      "erfragt ist. Niemals nach der Telefonnummer fragen. Die Bestellung erst bestätigen, " +
      "wenn dieses Werkzeug erfolgreich war; danach die bestätigte Abholzeit nennen und " +
      "die vierstellige Bestellnummer zweimal vorlesen.",
    parameters: z.object({
      items: pickupItemsParameter,
      guest_name: z.string().describe("Name, auf den die Bestellung läuft"),
      date: pickupDateParameter,
      time: pickupTimeParameter,
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (
      args,
    ): Promise<
      ToolReply<{
        order_number: string;
        total: string;
        ready_date: string;
        ready_time: string;
      }>
    > => {
      const startedAt = Date.now();
      const language = resolveToolLanguage(deps, args.language);
      const logInput = {
        items: args.items.map((item) => ({
          menu_item_id: item.menu_item_id,
          quantity: item.quantity,
        })),
        date: args.date ?? null,
        time: args.time ?? null,
        language,
      };
      const outcome = await createPickupOrder(
        deps.database,
        {
          restaurant_id: deps.restaurantId,
          items: args.items.map((item) => ({
            menu_item_id: item.menu_item_id,
            quantity: item.quantity,
            note: item.note ?? null,
          })),
          date: args.date ?? null,
          time: args.time ?? null,
          guest_name: args.guest_name,
          // Телефон намеренно не входит в tool-схему LLM: агент не запрашивает номер
          // ни при брони, ни при самовывозе (PROJECT.md §6).
          guest_phone: null,
          language,
        },
        language,
      );

      if (!outcome.ok) {
        const reply = failure(deps.session.phrases, outcome.error);
        logToolResult("create_pickup_order", logInput, reply, startedAt);
        return reply;
      }
      const reply = {
        ok: true,
        order_number: outcome.value.order_number,
        total: outcome.value.total,
        // Подтверждённое базой время: названное гостем могло быть округлено вверх до
        // ближайшего 15-минутного слота, и гостю называется именно это значение.
        ready_date: outcome.value.ready_date,
        ready_time: outcome.value.ready_time,
      } as const;
      logToolResult("create_pickup_order", logInput, reply, startedAt);
      return reply;
    },
  });
}
