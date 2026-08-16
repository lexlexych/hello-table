"use client";

import dynamic from "next/dynamic";

/**
 * `livekit-client` работает только в браузере, поэтому компонент звонка не рендерится на
 * сервере. Обёртка нужна потому, что `ssr: false` допустим лишь в клиентском компоненте.
 */
const TestCall = dynamic(() => import("./test-call"), {
  ssr: false,
  loading: () => <p className="call-status">Загружаю клиент звонка…</p>,
});

export function TestCallPanel() {
  return <TestCall />;
}
