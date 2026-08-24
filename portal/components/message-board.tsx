"use client";

import {
  CALLBACK_REQUEST_STATUSES,
  type CallbackRequestStatus,
} from "@hello-table/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { apiSend } from "@/lib/client-api";
import type { CallbackMessage } from "@/lib/messages";

function nextStatus(status: CallbackRequestStatus): CallbackRequestStatus {
  if (status === "new") return "in_progress";
  return status === "in_progress" ? "done" : "in_progress";
}

export function MessageBoard({ messages }: { messages: CallbackMessage[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  async function move(message: CallbackMessage) {
    if (busyId) return;
    setBusyId(message.id);
    setError(undefined);
    const result = await apiSend(
      `/api/messages/${message.id}/status`,
      "PATCH",
      { status: nextStatus(message.status) },
    );
    setBusyId(undefined);
    if (!result.ok) {
      setError(
        {
          invalid_body: t("messages.error.invalid"),
          not_found: t("messages.error.notFound"),
          forbidden: t("common.forbidden"),
          unauthorized: t("common.sessionExpired"),
          network: t("common.networkError"),
        }[result.failure.code] ?? t("messages.changeFailed"),
      );
      return;
    }
    router.refresh();
  }

  async function remove(message: CallbackMessage) {
    if (busyId || !window.confirm(t("messages.deleteConfirm"))) {
      return;
    }
    setBusyId(message.id);
    setError(undefined);
    const result = await apiSend(`/api/messages/${message.id}`, "DELETE");
    setBusyId(undefined);
    if (!result.ok) {
      setError(
        {
          invalid_body: t("messages.error.invalid"),
          not_found: t("messages.error.notFound"),
          forbidden: t("common.forbidden"),
          unauthorized: t("common.sessionExpired"),
          network: t("common.networkError"),
        }[result.failure.code] ?? t("messages.deleteFailed"),
      );
      return;
    }
    router.refresh();
  }

  const newCount = messages.filter(
    (message) => message.status === "new",
  ).length;
  const openCount = messages.filter(
    (message) => message.status !== "done",
  ).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("messages.title")}</h1>
          <p>{t("messages.subtitle")}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" onClick={() => router.refresh()}>
            {t("common.refresh")}
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{newCount}</span>
          <span className="stat-label">{t("messages.new")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{openCount}</span>
          <span className="stat-label">{t("messages.attention")}</span>
        </div>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="message-board">
        {CALLBACK_REQUEST_STATUSES.map((status) => {
          const column = messages.filter(
            (message) => message.status === status,
          );
          return (
            <section
              className="message-column"
              aria-label={t(`messages.status.${status}`)}
              key={status}
            >
              <div className="board-column-head">
                <span>{t(`messages.status.${status}`)}</span>
                <span className="board-count">{column.length}</span>
              </div>
              {column.length === 0 ? (
                <p className="board-empty">{t("common.empty")}</p>
              ) : (
                column.map((message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    busy={busyId !== undefined}
                    onMove={() => void move(message)}
                    onDelete={() => void remove(message)}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function MessageCard({
  message,
  busy,
  onMove,
  onDelete,
}: {
  message: CallbackMessage;
  busy: boolean;
  onMove: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <article className="message-card">
      <header className="message-card-head">
        <span className="badge">
          {t(`messages.category.${message.category}`)}
        </span>
        <span className="message-card-head-meta">
          <time>{message.createdAtLocal}</time>
          <button
            type="button"
            className="message-delete"
            disabled={busy}
            onClick={onDelete}
            aria-label={t("messages.deleteLabel")}
            title={t("messages.deleteLabel")}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5" />
            </svg>
          </button>
        </span>
      </header>
      <p className="message-summary">{message.summary}</p>
      <dl className="message-meta">
        <div>
          <dt>{t("messages.contact")}</dt>
          <dd>
            {message.contactValue ?? t("common.notSpecified")}
            {message.contactKind === "telegram_id" ? " (Telegram ID)" : ""}
          </dd>
        </div>
        <div>
          <dt>{t("messages.source")}</dt>
          <dd>{t(`messages.source.${message.source}`)}</dd>
        </div>
        <div>
          <dt>{t("messages.language")}</dt>
          <dd>{message.language.toUpperCase()}</dd>
        </div>
        {message.handledBy ? (
          <div>
            <dt>{t("messages.owner")}</dt>
            <dd>{message.handledBy}</dd>
          </div>
        ) : null}
      </dl>
      <button type="button" disabled={busy} onClick={onMove}>
        {t(`messages.action.${message.status}`)}
      </button>
    </article>
  );
}
