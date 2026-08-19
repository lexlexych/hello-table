import type { VoiceMode } from "@hello-table/contracts";
import { voiceModeSchema } from "@hello-table/contracts";
import type postgres from "postgres";
import type { VoiceSettingsInput } from "./schemas/settings";

interface VoiceSettingsRow {
  voiceMode: unknown;
}

export interface VoiceSettings {
  voiceMode: VoiceMode;
}

function parseRow(row: VoiceSettingsRow | undefined): VoiceSettings | undefined {
  return row === undefined
    ? undefined
    : { voiceMode: voiceModeSchema.parse(row.voiceMode) };
}

/** Настройка всегда ограничена restaurantId текущего экземпляра портала. */
export async function getVoiceSettings(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<VoiceSettings | undefined> {
  const [row] = await sql<VoiceSettingsRow[]>`
    SELECT voice_mode AS "voiceMode"
    FROM restaurants
    WHERE id = ${restaurantId} AND is_active`;
  return parseRow(row);
}

export async function updateVoiceSettings(
  sql: postgres.Sql,
  restaurantId: string,
  input: VoiceSettingsInput,
): Promise<VoiceSettings | undefined> {
  const [row] = await sql<VoiceSettingsRow[]>`
    UPDATE restaurants
    SET voice_mode = ${input.voiceMode}
    WHERE id = ${restaurantId} AND is_active
    RETURNING voice_mode AS "voiceMode"`;
  return parseRow(row);
}
