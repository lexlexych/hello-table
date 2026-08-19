import { VoiceModeSettings } from "@/components/voice-mode-settings";
import { db } from "@/lib/db";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";
import { getVoiceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSessionForPage(["admin"]);
  const sql = db();
  const settings = await getVoiceSettings(sql, await getRestaurantId(sql));
  if (!settings) {
    throw new Error("Настройки активного ресторана не найдены");
  }
  return <VoiceModeSettings initialMode={settings.voiceMode} />;
}
