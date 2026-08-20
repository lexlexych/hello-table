"use client";

import {
  CALLBACK_REQUEST_STATUSES,
  type CallbackRequestStatus,
} from "@hello-table/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/client-api";
import type { CallbackMessage } from "@/lib/messages";
import {
  MESSAGE_ACTION_ERRORS,
  MESSAGE_STATUS_LABELS,
} from "@/lib/schemas/messages";

const CATEGORY_LABELS = {
  banquet: "Банкет",
  complaint: "Жалоба",
  special: "Особое пожелание",
  other: "Другой вопрос",
} as const;

const SOURCE_LABELS = {
  voice: "Голосовой ассистент",
  telegram: "Telegram",
} as const;

function nextStatus(status: CallbackRequestStatus): CallbackRequestStatus {
  if (status === "new") return "in_progress";
  return status === "in_progress" ? "done" : "in_progress";
}

function actionLabel(status: CallbackRequestStatus): string {
  if (status === "new") return "Взять в работу";
  return status === "in_progress" ? "Обработано" : "Вернуть в работу";
}

export function MessageBoard({ messages }: { messages: CallbackMessage[] }) {
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
        MESSAGE_ACTION_ERRORS[result.failure.code] ??
          "Не удалось изменить статус сообщения.",
      );
      return;
    }
    router.refresh();
  }

  async function remove(message: CallbackMessage) {
    if (
      busyId ||
      !window.confirm(
        "Удалить сообщение без возможности восстановления?",
      )
    ) {
      return;
    }
    setBusyId(message.id);
    setError(undefined);
    const result = await apiSend(`/api/messages/${message.id}`, "DELETE");
    setBusyId(undefined);
    if (!result.ok) {
      setError(
        MESSAGE_ACTION_ERRORS[result.failure.code] ??
          "Не удалось удалить сообщение.",
      );
      return;
    }
    router.refresh();
  }

  const newCount = messages.filter((message) => message.status === "new").length;
  const openCount = messages.filter(
    (message) => message.status !== "done",
  ).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Сообщения</h1>
          <p>Запросы клиентов, которым требуется ответ оператора.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" onClick={() => router.refresh()}>
            Обновить
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{newCount}</span>
          <span className="stat-label">новых</span>
        </div>
        <div className="stat">
          <span className="stat-value">{openCount}</span>
          <span className="stat-label">требуют внимания</span>
        </div>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="message-board">
        {CALLBACK_REQUEST_STATUSES.map((status) => {
          const column = messages.filter((message) => message.status === status);
          return (
            <section
              className="message-column"
              aria-label={MESSAGE_STATUS_LABELS[status]}
              key={status}
            >
              <div className="board-column-head">
                <span>{MESSAGE_STATUS_LABELS[status]}</span>
                <span className="board-count">{column.length}</span>
              </div>
              {column.length === 0 ? (
                <p className="board-empty">пусто</p>
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
  return (
    <article className="message-card">
      <header className="message-card-head">
        <span className="badge">{CATEGORY_LABELS[message.category]}</span>
        <span className="message-card-head-meta">
          <time>{message.createdAtLocal}</time>
          <button
            type="button"
            className="message-delete"
            disabled={busy}
            onClick={onDelete}
            aria-label="Удалить сообщение"
            title="Удалить сообщение"
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
          <dt>Контакт</dt>
          <dd>
            {message.contactValue ?? "не указан"}
            {message.contactKind === "telegram_id" ? " (Telegram ID)" : ""}
          </dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd>{SOURCE_LABELS[message.source]}</dd>
        </div>
        <div>
          <dt>Язык</dt>
          <dd>{message.language.toUpperCase()}</dd>
        </div>
        {message.handledBy ? (
          <div>
            <dt>Ответственный</dt>
            <dd>{message.handledBy}</dd>
          </div>
        ) : null}
      </dl>
      <button type="button" disabled={busy} onClick={onMove}>
        {actionLabel(message.status)}
      </button>
    </article>
  );
}
