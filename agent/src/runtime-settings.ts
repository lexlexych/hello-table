import { type VoiceMode, voiceModeSchema } from "@hello-table/contracts";
import type { AgentDatabase } from "./tools/database.ts";

interface RuntimeSettingsRow {
  voice_mode: unknown;
}

/** Читает выбранный движок до создания аудиографа сессии. */
export async function getAgentRuntimeSettings(
  sql: AgentDatabase,
  restaurantId: string,
): Promise<{ voiceMode: VoiceMode }> {
  const rows = await sql<RuntimeSettingsRow[]>`
    SELECT voice_mode
    FROM get_agent_runtime_settings(${restaurantId}::uuid)
  `;
  const row = rows[0];
  if (row === undefined) {
    throw new Error("get_agent_runtime_settings returned no row");
  }
  return { voiceMode: voiceModeSchema.parse(row.voice_mode) };
}
