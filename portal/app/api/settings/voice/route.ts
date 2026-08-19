import { type NextRequest, NextResponse } from "next/server";
import {
  dbFailure,
  NOT_FOUND,
  parseBody,
  requireAdmin,
  writeContext,
} from "@/lib/api";
import { voiceSettingsInputSchema } from "@/lib/schemas/settings";
import { updateVoiceSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const parsed = await parseBody(request, voiceSettingsInputSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { sql, restaurantId } = await writeContext();
    const settings = await updateVoiceSettings(
      sql,
      restaurantId,
      parsed.value,
    );
    return settings ? NextResponse.json(settings) : NOT_FOUND();
  } catch (error) {
    return dbFailure(error);
  }
}
