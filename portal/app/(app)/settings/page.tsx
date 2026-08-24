import { VoiceModeSettings } from "@/components/voice-mode-settings";
import { db } from "@/lib/db";
import { translate } from "@/lib/i18n/catalog";
import { getPortalLocale } from "@/lib/i18n/server";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";
import { getVoiceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSessionForPage(["admin"]);
  const sql = db();
  const settings = await getVoiceSettings(sql, await getRestaurantId(sql));
  const locale = await getPortalLocale();
  if (!settings) {
    throw new Error(translate(locale, "settings.notFound"));
  }
  return <VoiceModeSettings initialMode={settings.voiceMode} />;
}
