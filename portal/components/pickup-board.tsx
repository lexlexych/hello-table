"use client";

import {
  PICKUP_ORDER_STATUSES,
  type PickupOrderStatus,
} from "@hello-table/contracts";
import { useRouter } from "next/navigation";
import { type DragEvent, useEffect, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import {
  type PickupMenuItem,
  PickupOrderForm,
} from "@/components/pickup-order-form";
import { apiSend } from "@/lib/client-api";
import { intlLocale } from "@/lib/i18n/catalog";
import type { PickupOrder } from "@/lib/pickup";
import { formatEuros } from "@/lib/schemas/menu";

/**
 * Канбан заказов на самовывоз (PROJECT.md §7.3). Колонок ровно столько, сколько
 * статусов в базе, и в том же порядке — доска не придумывает собственных состояний
 * и потому не может разойтись с тем, что видит голосовой агент.
 *
 * Доска всегда сегодняшняя: заказы отбираются по местной дате выдачи, завтра она
 * начинается пустой. Своей копии списка компонент не держит — после каждой удачной
 * записи `router.refresh()` перечитывает серверный компонент.
 */

/** За сколько минут до выдачи карточка начинает предупреждать. */
const SOON_MINUTES = 30;

/** Пересчёт срочности: чаще незачем, реже — заметно опоздание на границе. */
const TICK_MS = 30_000;

/** Заказ закрыт — торопиться уже некуда, цвет срочности на нём не показывается. */
const CLOSED: ReadonlySet<PickupOrderStatus> = new Set([
  "picked_up",
  "cancelled",
]);

type Urgency = "soon" | "late" | undefined;

/**
 * `now` приходит извне и до монтирования равен `undefined`: серверный и клиентский
 * рендер обязаны совпасть, а «сколько сейчас времени» у них разное. Поэтому первая
 * отрисовка нейтральная, а цвет появляется через мгновение на клиенте.
 */
function urgencyOf(order: PickupOrder, now: number | undefined): Urgency {
  if (now === undefined || CLOSED.has(order.status)) {
    return undefined;
  }
  const readyAt = Date.parse(order.readyAt);
  if (Number.isNaN(readyAt)) {
    return undefined;
  }
  if (readyAt <= now) {
    return "late";
  }
  return readyAt - now <= SOON_MINUTES * 60_000 ? "soon" : undefined;
}

export function PickupBoard({
  orders,
  menu,
}: {
  orders: PickupOrder[];
  menu: PickupMenuItem[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [now, setNow] = useState<number | undefined>(undefined);
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  const [over, setOver] = useState<PickupOrderStatus | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function show(message: string) {
    setToast(message);
    // Всплывающее сообщение живёт три секунды: оно подтверждает, а не информирует.
    setTimeout(() => setToast(undefined), 3000);
  }

  async function move(order: PickupOrder, status: PickupOrderStatus) {
    if (status === order.status || busy) {
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await apiSend(`/api/pickup/${order.id}/status`, "PATCH", {
      status,
    });
    setBusy(false);

    if (!result.ok) {
      const errors: Record<string, string> = {
        duplicate: t("pickup.error.duplicate"),
        invalid: t("pickup.error.invalid"),
        invalid_body: t("pickup.error.invalid_body"),
        not_found: t("pickup.error.not_found"),
        forbidden: t("common.forbidden"),
        unauthorized: t("common.sessionExpired"),
        network: t("common.networkError"),
      };
      setError(errors[result.failure.code] ?? t("pickup.moveFailed"));
      return;
    }
    show(
      t("pickup.moved", {
        number: order.orderNumber,
        status: t(`pickup.status.${status}`),
      }),
    );
    router.refresh();
  }

  function onDrop(event: DragEvent<HTMLElement>, status: PickupOrderStatus) {
    event.preventDefault();
    setOver(undefined);
    // Состояние надёжнее dataTransfer: Firefox отдаёт данные только в onDrop, а
    // подсветку колонки надо рисовать раньше. dataTransfer остаётся запасным путём.
    const id = dragged ?? event.dataTransfer.getData("text/plain");
    setDragged(undefined);
    const order = orders.find((candidate) => candidate.id === id);
    if (order) {
      void move(order, status);
    }
  }

  const total = orders.length;
  const openCount = orders.filter((order) => !CLOSED.has(order.status)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("pickup.title")}</h1>
          <p className="note">{t("pickup.subtitle")}</p>
        </div>
        <div className="page-head-actions">
          <button type="button" onClick={() => router.refresh()}>
            {t("common.refresh")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setCreating(true)}
          >
            {t("pickup.newOrder")}
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{total}</span>
          <span className="stat-label">{t("pickup.ordersToday")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{openCount}</span>
          <span className="stat-label">{t("pickup.inProgress")}</span>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="board">
        {PICKUP_ORDER_STATUSES.map((status) => {
          const column = orders.filter((order) => order.status === status);
          return (
            // `section` с меткой, а не `div`: колонка принимает перетаскивание и обязана
            // быть названной областью, иначе для скринридера она немой контейнер.
            <section
              key={status}
              aria-label={t(`pickup.status.${status}`)}
              className={`board-column${over === status ? " is-over" : ""}`}
              onDragOver={(event) => {
                // Без preventDefault браузер считает колонку недопустимой целью.
                event.preventDefault();
                setOver(status);
              }}
              onDragLeave={() =>
                setOver((current) => (current === status ? undefined : current))
              }
              onDrop={(event) => onDrop(event, status)}
            >
              <div className="board-column-head">
                <span>{t(`pickup.status.${status}`)}</span>
                <span className="board-count">{column.length}</span>
              </div>

              {column.length === 0 ? (
                <p className="board-empty">{t("common.empty")}</p>
              ) : (
                column.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    urgency={urgencyOf(order, now)}
                    busy={busy}
                    onDragStart={(event) => {
                      setDragged(order.id);
                      event.dataTransfer.setData("text/plain", order.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragged(undefined);
                      setOver(undefined);
                    }}
                    onMove={(next) => void move(order, next)}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>

      {creating ? (
        <PickupOrderForm
          menu={menu}
          onClose={() => setCreating(false)}
          onCreated={(message) => {
            setCreating(false);
            show(message);
            router.refresh();
          }}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}

function OrderCard({
  order,
  urgency,
  busy,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  order: PickupOrder;
  urgency: Urgency;
  busy: boolean;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onMove: (status: PickupOrderStatus) => void;
}) {
  const { locale, t } = useI18n();
  const index = PICKUP_ORDER_STATUSES.indexOf(order.status);
  const previous = PICKUP_ORDER_STATUSES[index - 1];
  const next = PICKUP_ORDER_STATUSES[index + 1];

  return (
    <article
      className={`order-card${urgency ? ` is-${urgency}` : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <header className="order-card-head">
        <span className="order-number">№ {order.orderNumber}</span>
        <span className="order-time">{order.readyAtLocal}</span>
      </header>

      <p className="order-guest">
        {order.guestName}
        {order.guestPhone ? ` · ${order.guestPhone}` : ""}
        <span className="badge">
          {order.source === "phone" ||
          order.source === "portal" ||
          order.source === "test"
            ? t(`pickup.source.${order.source}`)
            : order.source}
        </span>
      </p>

      <ul className="order-lines">
        {order.items.map((line) => (
          <li key={line.id}>
            <span className="order-line-name">
              {line.name} × {line.quantity}
            </span>
            {line.note ? (
              <span className="order-line-note">{line.note}</span>
            ) : null}
          </li>
        ))}
      </ul>

      <footer className="order-card-foot">
        <span className="order-total">
          {formatEuros(order.totalCents, intlLocale(locale))}
        </span>
        <span className="order-move">
          <button
            type="button"
            className="ghost"
            disabled={busy || !previous}
            onClick={() => previous && onMove(previous)}
            aria-label={
              previous
                ? t("pickup.previous", {
                    status: t(`pickup.status.${previous}`),
                  })
                : t("pickup.noPrevious")
            }
          >
            ←
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || !next}
            onClick={() => next && onMove(next)}
            aria-label={
              next
                ? t("pickup.next", { status: t(`pickup.status.${next}`) })
                : t("pickup.noNext")
            }
          >
            →
          </button>
        </span>
      </footer>
    </article>
  );
}
