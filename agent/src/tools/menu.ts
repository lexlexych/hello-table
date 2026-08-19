import type { MenuCategory } from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { getCurrentMenu } from "./menu-db.ts";
import {
  failure,
  resolveToolLanguage,
  type ToolDeps,
  type ToolReply,
  toolLanguageParameter,
} from "./shared.ts";

/** Загружает полный доступный каталог при каждом вопросе гостя о меню. */
export function searchMenuTool(deps: ToolDeps) {
  return llm.tool({
    name: "search_menu",
    description:
      "Lädt das vollständige aktuelle Menü mit Kategorien, Zutaten, Allergenen, Preisen " +
      "und Ernährungsmerkmalen. Bei jeder Frage zum Menü aufrufen und ausschließlich " +
      "anhand dieses Ergebnisses antworten.",
    parameters: z.object({
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (
      args,
    ): Promise<ToolReply<{ categories: MenuCategory[] }>> => {
      const language = resolveToolLanguage(deps, args.language);
      const outcome = await getCurrentMenu(deps.database, {
        restaurant_id: deps.restaurantId,
        language,
      });

      if (!outcome.ok) return failure(deps.session.phrases, outcome.error);
      return { ok: true, categories: outcome.value.categories };
    },
  });
}
