"use client";

import type { VoiceMode } from "@hello-table/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { apiSend } from "@/lib/client-api";
import { PORTAL_LOCALES, type PortalLocale } from "@/lib/i18n/catalog";

const OPTIONS: ReadonlyArray<{
  value: VoiceMode;
  title: string;
}> = [
  { value: "pipeline", title: "Pipeline" },
  { value: "realtime", title: "OpenAI Realtime" },
];

export function VoiceModeSettings({ initialMode }: { initialMode: VoiceMode }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [selectedLocale, setSelectedLocale] = useState(locale);
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
      const errors: Record<string, string> = {
        forbidden: t("settings.voice.adminOnly"),
        unauthorized: t("common.sessionExpired"),
        invalid_body: t("settings.voice.invalid"),
        network: t("common.networkError"),
        not_found: t("settings.voice.notFound"),
      };
      setMessage(errors[result.failure.code] ?? t("settings.voice.failed"));
      return;
    }
    const voiceMode = result.data?.voiceMode ?? mode;
    setMode(voiceMode);
    setSavedMode(voiceMode);
    setMessage(t("settings.voice.saved"));
  }

  async function saveLocale(nextLocale: PortalLocale) {
    if (nextLocale === selectedLocale) return;
    const previousLocale = selectedLocale;
    setSelectedLocale(nextLocale);
    setBusy(true);
    setMessage(undefined);
    const result = await apiSend<{ locale: PortalLocale }>(
      "/api/settings/locale",
      "PATCH",
      { locale: nextLocale },
    );
    setBusy(false);
    if (!result.ok) {
      setSelectedLocale(previousLocale);
      const errors: Record<string, string> = {
        forbidden: t("settings.voice.adminOnly"),
        unauthorized: t("common.sessionExpired"),
        invalid_body: t("settings.language.invalid"),
        network: t("common.networkError"),
      };
      setMessage(errors[result.failure.code] ?? t("settings.language.failed"));
      return;
    }
    setMessage(t("settings.language.saved"));
    router.refresh();
  }

  return (
    <section className="settings-page">
      <header className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
          <p>{t("settings.scope")}</p>
        </div>
      </header>

      <form className="settings-card" onSubmit={save}>
        <fieldset className="voice-mode-fieldset" disabled={busy}>
          <legend>{t("settings.voice.title")}</legend>
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
                  <small>{t(`settings.voice.${option.value}`)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <p className="settings-note">{t("settings.voice.note")}</p>

        <fieldset className="voice-mode-fieldset settings-language-fieldset" disabled={busy}>
          <legend>{t("settings.language.title")}</legend>
          <div className="settings-language-head">
            <p className="settings-note">{t("settings.language.description")}</p>
            <strong className="settings-current" aria-live="polite">
              {t("settings.language.current", {
                language: t(`settings.language.${selectedLocale}`),
              })}
            </strong>
          </div>
          <div className="language-choice-grid">
            {PORTAL_LOCALES.map((value) => (
              <label
                className={`voice-mode-option language-choice${selectedLocale === value ? " selected" : ""}`}
                key={value}
              >
                <input
                  type="radio"
                  name="portalLocale"
                  value={value}
                  checked={selectedLocale === value}
                  onChange={() => void saveLocale(value)}
                />
                <span>
                  <strong>{t(`settings.language.${value}`)}</strong>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {message ? <p className="settings-message">{message}</p> : null}
        <button className="primary" type="submit" disabled={!changed || busy}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </section>
  );
}
