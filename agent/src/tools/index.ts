import type { Config } from "../config.ts";
import type { GermanPhrases } from "../session.ts";
import { requestCallbackTool } from "./callback.ts";
import {
  checkAvailabilityTool,
  createReservationTool,
  type ToolDeps,
} from "./reservations.ts";

/**
 * Набор инструментов агента. Имена и пути вебхуков — docs/PROJECT.md §6,
 * контракты — docs/tool-contracts.md.
 *
 * `sessionId` — имя комнаты LiveKit: неперсональный идентификатор разговора, по
 * которому n8n связывает запросы одного звонка.
 */
export function buildTools(
  config: Config,
  phrases: GermanPhrases,
  sessionId: string,
) {
  const deps: ToolDeps = {
    client: {
      baseUrl: config.N8N_BASE_URL,
      secret: config.N8N_WEBHOOK_SECRET,
      timeoutMs: config.N8N_TIMEOUT_MS,
    },
    phrases,
    restaurantId: config.RESTAURANT_ID,
    sessionId,
  };

  // Список, а не объект: инструменты объявлены с собственными именами, и объектная
  // форма в @livekit/agents принимает только безымянные определения.
  return [
    checkAvailabilityTool(deps),
    createReservationTool(deps),
    requestCallbackTool(deps),
  ];
}
