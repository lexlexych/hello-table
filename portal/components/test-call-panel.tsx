"use client";

import dynamic from "next/dynamic";
import { useI18n } from "@/components/i18n-provider";

/**
 * `livekit-client` работает только в браузере, поэтому компонент звонка не рендерится на
 * сервере. Обёртка нужна потому, что `ssr: false` допустим лишь в клиентском компоненте.
 */
const TestCall = dynamic(() => import("./test-call"), {
  ssr: false,
  loading: () => <TestCallLoading />,
});

export function TestCallPanel() {
  return <TestCall />;
}

function TestCallLoading() {
  const { t } = useI18n();
  return <p className="call-status">{t("testCall.loadingClient")}</p>;
}
