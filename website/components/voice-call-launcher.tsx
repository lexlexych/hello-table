"use client";

import dynamic from "next/dynamic";
import type { Language } from "@/lib/menu";

/**
 * `livekit-client` работает только в браузере, поэтому виджет звонка не рендерится на
 * сервере. Обёртка нужна потому, что `ssr: false` допустим лишь в клиентском компоненте.
 */
const VoiceCall = dynamic(() => import("./voice-call"), { ssr: false });

export function VoiceCallLauncher({ language }: { language: Language }) {
  return <VoiceCall language={language} />;
}
