import type { MenuCategory } from "@hello-table/contracts";
import { llm, log } from "@livekit/agents";
import { z } from "zod";
import { getCurrentMenu } from "./menu-db.ts";
import {
  failure,
  resolveToolLanguage,
  type ToolDeps,
  type ToolReply,
  toolLanguageParameter,
} from "./shared.ts";
import { logToolResult } from "./tool-logging.ts";

/**
 * Загружает полный доступный каталог один раз за звонок на каждый язык разговора.
 *
 * Прежняя версия читала базу при каждом вопросе о меню. Внутри одного разговора каталог
 * не меняется, поэтому повторное чтение давало только лишний RPC и вторую копию всего
 * меню в контексте. Свежести это не стоит: доступность и цены позиций перед оформлением
 * заказа всё равно перепроверяет `create_pickup_order_atomic` на стороне базы.
 */
export function searchMenuTool(deps: ToolDeps) {
  return llm.tool({
    name: "search_menu",
    description:
      "Lädt das vollständige aktuelle Menü mit Kategorien, Zutaten, Allergenen, Preisen, " +
      "Gericht-IDs und Ernährungsmerkmalen. Einmal pro Gespräch aufrufen, sobald das Menü " +
      "zum ersten Mal gebraucht wird; danach ausschließlich anhand dieses bereits " +
      "vorliegenden Ergebnisses antworten und das Werkzeug nicht erneut aufrufen.",
    parameters: z.object({
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (
      args,
    ): Promise<ToolReply<{ categories: MenuCategory[] }>> => {
      const startedAt = Date.now();
      const language = resolveToolLanguage(deps, args.language);
      const logInput = { language };
      const cached = deps.menuCache.get(language);
      if (cached !== undefined) {
        log().info(
          { rpc: "get_current_menu", result: "cached" },
          "database rpc",
        );
        const reply = { ok: true as const, categories: cached };
        logToolResult("search_menu", logInput, reply, startedAt);
        return reply;
      }

      const outcome = await getCurrentMenu(deps.database, {
        restaurant_id: deps.restaurantId,
        language,
      });

      if (!outcome.ok) {
        const reply = failure(deps.session.phrases, outcome.error);
        logToolResult("search_menu", logInput, reply, startedAt);
        return reply;
      }
      deps.menuCache.set(language, outcome.value.categories);
      const reply = {
        ok: true as const,
        categories: outcome.value.categories,
      };
      logToolResult("search_menu", logInput, reply, startedAt);
      return reply;
    },
  });
}
