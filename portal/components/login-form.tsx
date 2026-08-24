"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(form.get("username") ?? ""),
        password: String(form.get("password") ?? ""),
      }),
    }).catch(() => undefined);

    if (response?.ok) {
      router.replace("/test-call");
      router.refresh();
      return;
    }

    const body: unknown = await response?.json().catch(() => undefined);
    const code =
      typeof body === "object" && body !== null
        ? String((body as Record<string, unknown>).error ?? "")
        : "";
    const messages: Record<string, string> = {
      missing_fields: t("login.missing"),
      invalid_credentials: t("login.invalid"),
      rate_limited: t("login.rateLimited"),
    };
    setError(messages[code] ?? t("login.failed"));
    setBusy(false);
  }

  return (
    <form className="login-card" onSubmit={onSubmit}>
      <h1>{t("login.title")}</h1>
      {error ? <p className="form-error">{error}</p> : null}
      <label className="field">
        <span>{t("login.username")}</span>
        <input name="username" autoComplete="username" required />
      </label>
      <label className="field">
        <span>{t("login.password")}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? t("login.checking") : t("login.submit")}
      </button>
    </form>
  );
}
