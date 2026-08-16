"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

const MESSAGES: Record<string, string> = {
  missing_fields: "Заполните оба поля.",
  invalid_credentials: "Неверный логин или пароль.",
  rate_limited: "Слишком много попыток входа. Попробуйте позже.",
};

export function LoginForm() {
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
    setError(MESSAGES[code] ?? "Не удалось войти. Попробуйте ещё раз.");
    setBusy(false);
  }

  return (
    <form className="login-card" onSubmit={onSubmit}>
      <h1>Вход в портал</h1>
      {error ? <p className="form-error">{error}</p> : null}
      <label className="field">
        <span>Логин</span>
        <input name="username" autoComplete="username" required />
      </label>
      <label className="field">
        <span>Пароль</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Проверяю…" : "Войти"}
      </button>
    </form>
  );
}
