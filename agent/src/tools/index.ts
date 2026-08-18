import type { Config } from "../config.ts";
import type { SessionLanguageState } from "../session.ts";
import type { AgentDatabase } from "./database.ts";
import { searchMenuTool } from "./menu.ts";
import {
  checkAvailabilityTool,
  createReservationTool,
} from "./reservations.ts";
import type { ToolDeps } from "./shared.ts";

/**
 * Набор инструментов агента. Бронирование вызывает Postgres RPC напрямую;
 * контракты — docs/tool-contracts.md.
 */
export function buildTools(
  config: Config,
  session: SessionLanguageState,
  database: AgentDatabase,
) {
  const deps: ToolDeps = {
    database,
    session,
    restaurantId: config.RESTAURANT_ID,
  };

  // Список, а не объект: инструменты объявлены с собственными именами, и объектная
  // форма в @livekit/agents принимает только безымянные определения.
  return [
    checkAvailabilityTool(deps),
    createReservationTool(deps),
    searchMenuTool(deps),
  ];
}
