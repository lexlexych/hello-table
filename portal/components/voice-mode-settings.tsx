"use client";

import type { VoiceMode } from "@hello-table/contracts";
import { type FormEvent, useState } from "react";
import { apiSend } from "@/lib/client-api";

const OPTIONS: ReadonlyArray<{
  value: VoiceMode;
  title: string;
  description: string;
}> = [
  {
    value: "pipeline",
    title: "Pipeline",
    description:
      "Отдельные OpenAI STT, текстовая модель и TTS. Текущий стабильный режим.",
  },
  {
    value: "realtime",
    title: "OpenAI Realtime",
    description:
      "Одна audio-to-audio модель без отдельных STT и TTS. Ожидается меньшая задержка, но стоимость выше.",
  },
];

const ERRORS: Record<string, string> = {
  forbidden: "Изменение доступно только администратору.",
  unauthorized: "Сессия истекла. Войдите заново.",
  invalid_body: "Выберите один из двух режимов.",
  network: "Сервер недоступен. Проверьте соединение.",
  not_found: "Ресторан больше не активен. Обновите страницу.",
};

export function VoiceModeSettings({ initialMode }: { initialMode: VoiceMode }) {
  const [savedMode, setSavedMode] = useState(initialMode);
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const changed = mode !== savedMode;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed) return;
    setBusy(true);
    setMessage(undefined);
    const result = await apiSend<{ voiceMode: VoiceMode }>(
      "/api/settings/voice",
      "PATCH",
      { voiceMode: mode },
    );
    setBusy(false);
    if (!result.ok) {
      setMessage(ERRORS[result.failure.code] ?? "Не удалось сохранить настройку.");
      return;
    }
    const voiceMode = result.data?.voiceMode ?? mode;
    setMode(voiceMode);
    setSavedMode(voiceMode);
    setMessage("Сохранено. Новый режим применится к следующему звонку.");
  }

  return (
    <section className="settings-page">
      <header className="page-head">
        <div>
          <h1>Настройки голосового агента</h1>
          <p>Выбор относится только к ресторану этого портала.</p>
        </div>
      </header>

      <form className="settings-card" onSubmit={save}>
        <fieldset className="voice-mode-fieldset" disabled={busy}>
          <legend>Режим обработки звонка</legend>
          <div className="voice-mode-grid">
            {OPTIONS.map((option) => (
              <label
                className={`voice-mode-option${mode === option.value ? " selected" : ""}`}
                key={option.value}
              >
                <input
                  type="radio"
                  name="voiceMode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => {
                    setMode(option.value);
                    setMessage(undefined);
                  }}
                />
                <span>
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="settings-note">
          Активный звонок продолжит работу в прежнем режиме. Переключение не делает
          автоматический fallback при ошибке Realtime.
        </p>
        {message ? <p className="settings-message">{message}</p> : null}
        <button className="primary" type="submit" disabled={!changed || busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
      </form>
    </section>
  );
}
