import type { Language, VoiceMode } from "@hello-table/contracts";
import type { Config } from "../config.ts";
import type { Phrases, SessionLanguageState } from "../session.ts";
import type { AgentDatabase } from "./database.ts";
import { requestCallbackTool } from "./callback.ts";
import { searchMenuTool } from "./menu.ts";
import { checkPickupSlotsTool, createPickupOrderTool } from "./pickup.ts";
import {
  checkAvailabilityTool,
  createReservationTool,
} from "./reservations.ts";
import type { MenuCache, ToolDeps } from "./shared.ts";

/**
 * Набор инструментов агента. Бронирование, меню, самовывоз и сообщения оператору
 * вызывают Postgres RPC напрямую; контракты — docs/tool-contracts.md.
 */
export function buildTools(
  config: Config,
  session: SessionLanguageState,
  phrasesByLanguage: Partial<Record<Language, Phrases>>,
  database: AgentDatabase,
  voiceMode: VoiceMode,
) {
  // Кеш меню создаётся здесь и живёт ровно один звонок: buildTools вызывается на
  // каждую сессию, поэтому следующий гость получит каталог заново.
  const menuCache: MenuCache = new Map();
  const deps: ToolDeps = {
    database,
    menuCache,
    session,
    phrasesByLanguage,
    voiceMode,
    restaurantId: config.RESTAURANT_ID,
  };

  // Список, а не объект: инструменты объявлены с собственными именами, и объектная
  // форма в @livekit/agents принимает только безымянные определения.
  return [
    checkAvailabilityTool(deps),
    createReservationTool(deps),
    searchMenuTool(deps),
    checkPickupSlotsTool(deps),
    createPickupOrderTool(deps),
    requestCallbackTool(deps),
  ];
}
