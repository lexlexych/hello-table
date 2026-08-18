import type { MenuCategory } from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { withFiller } from "./filler.ts";
import { getCurrentMenu } from "./menu-db.ts";
import { failure, type ToolDeps, type ToolReply } from "./shared.ts";

/** Загружает полный доступный каталог при каждом вопросе гостя о меню. */
export function searchMenuTool(deps: ToolDeps) {
  return llm.tool({
    name: "search_menu",
    description:
      "Lädt das vollständige aktuelle Menü mit Kategorien, Zutaten, Allergenen, Preisen " +
      "und Ernährungsmerkmalen. Bei jeder Frage zum Menü aufrufen und ausschließlich " +
      "anhand dieses Ergebnisses antworten.",
    parameters: z.object({}),
    execute: async (
      _args,
      opts,
    ): Promise<ToolReply<{ categories: MenuCategory[] }>> => {
      const outcome = await withFiller(
        opts.ctx.session,
        deps.session.phrases.filler_checking,
        () =>
          getCurrentMenu(deps.database, {
            restaurant_id: deps.restaurantId,
            language: deps.session.language,
          }),
      );

      if (!outcome.ok) return failure(deps.session.phrases, outcome.error);
      return { ok: true, categories: outcome.value.categories };
    },
  });
}
