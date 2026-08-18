import {
  CALLBACK_CATEGORIES,
  languageSchema,
  requestCallbackResponseSchema,
  WEBHOOK_PATHS,
} from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { callWebhook, withFiller } from "./client.ts";
import { failure, type ToolDeps, type ToolReply } from "./reservations.ts";

/**
 * Сообщение менеджеру ресторана. Последний рубеж разговора: если вопрос не решается
 * инструментами, гость оставляет сообщение и менеджер перезванивает сам.
 *
 * Резюме составляет модель по жёсткому шаблону, лимит 400 символов держит и CHECK
 * на callback_requests.summary (PROJECT.md §6.2).
 */
export function requestCallbackTool(deps: ToolDeps) {
  return llm.tool({
    name: "request_callback",
    description:
      "Hinterlässt eine Nachricht für den Manager des Restaurants, damit dieser den Gast " +
      "zurückruft. Verwenden, wenn das Anliegen im Gespräch nicht lösbar ist: Bankett ab " +
      "15 Personen, Beschwerde, Sonderwunsch oder wiederholt fehlgeschlagene Werkzeuge. " +
      "Vorher die Telefonnummer erfragen und dem Gast sagen, dass der Manager sich meldet.",
    parameters: z.object({
      category: z
        .enum(CALLBACK_CATEGORIES)
        .describe(
          "banquet für Feiern ab 15 Personen, complaint für Beschwerden, " +
            "special für Sonderwünsche, other für alles Übrige",
        ),
      summary: z
        .string()
        .describe(
          "Kurze Zusammenfassung des Anliegens für den Manager, höchstens 400 Zeichen: " +
            "worum es geht, gewünschte Zeit, was bereits gesagt wurde",
        ),
      phone: z
        .string()
        .nullable()
        .describe("Rückrufnummer des Gastes oder null, wenn nicht genannt"),
    }),
    execute: async (
      args,
      opts,
    ): Promise<ToolReply<{ callback_id: string }>> => {
      const outcome = await withFiller(
        opts.ctx.session,
        deps.phrases.filler_sending,
        () =>
          callWebhook(
            deps.client,
            WEBHOOK_PATHS.request_callback,
            {
              restaurant_id: deps.restaurantId,
              session_id: deps.sessionId,
              category: args.category,
              summary: args.summary,
              phone: args.phone,
              language: languageSchema.enum.de,
            },
            requestCallbackResponseSchema,
          ),
      );

      if (!outcome.ok) return failure(deps.phrases, outcome.error);
      return { ok: true, callback_id: outcome.value.callback_id };
    },
  });
}
