import { callbackCategorySchema } from "@hello-table/contracts";
import { llm } from "@livekit/agents";
import { z } from "zod";
import { createCallbackRequest } from "./callback-db.ts";
import {
  failure,
  resolveToolLanguage,
  type ToolDeps,
  type ToolReply,
  toolLanguageParameter,
} from "./shared.ts";

/** Сообщение оператору после явного согласия гостя и подтверждения телефона. */
export function requestCallbackTool(deps: ToolDeps) {
  return llm.tool({
    name: "request_callback",
    description:
      "Speichert eine Rückrufnachricht für einen Operator. Nur aufrufen, nachdem der Gast " +
      "der Weitergabe ausdrücklich zugestimmt, eine Telefonnummer genannt und die " +
      "Wiederholung dieser Nummer bestätigt hat. Keine Nummer und keine Zusammenfassung " +
      "erfinden. Den Rückruf erst nach einem erfolgreichen Ergebnis bestätigen.",
    parameters: z.object({
      category: callbackCategorySchema.describe(
        "banquet, complaint, special oder other",
      ),
      summary: z
        .string()
        .trim()
        .min(1)
        .max(400)
        .describe("Kurze sachliche Zusammenfassung für den Operator"),
      phone: z
        .string()
        .trim()
        .min(3)
        .max(40)
        .describe("Vom Gast bestätigte Rückrufnummer, niemals geschätzt"),
      language: toolLanguageParameter(deps.voiceMode),
    }),
    execute: async (args): Promise<ToolReply<{ callback_id: string }>> => {
      const language = resolveToolLanguage(deps, args.language);
      const outcome = await createCallbackRequest(deps.database, {
        restaurant_id: deps.restaurantId,
        category: args.category,
        summary: args.summary,
        phone: args.phone,
        language,
      });
      if (!outcome.ok) return failure(deps.session.phrases, outcome.error);
      return { ok: true, callback_id: outcome.value.callback_id };
    },
  });
}
