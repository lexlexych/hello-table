"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Drawer } from "@/components/ui/drawer";
import { Toggle } from "@/components/ui/toggle";
import { apiSend } from "@/lib/client-api";
import { formatDayFull, formatDayLabel, isPastDay } from "@/lib/day";
import { intlLocale } from "@/lib/i18n/catalog";
import type { RestaurantTableForDay } from "@/lib/tables";

/**
 * Экран столиков. Данные приходят с сервера пропсом; после каждой удачной записи
 * вызывается `router.refresh()`, и серверный компонент перечитывает список — своей
 * копии состояния список не держит и рассинхронизироваться с базой не может.
 *
 * Выбранный день живёт в адресной строке, а не в состоянии: так ссылку на день можно
 * переслать, а перезагрузка страницы не сбрасывает выбор.
 */

interface Draft {
  id: string | undefined;
  label: string;
  seats: string;
  zone: string;
  isActive: boolean;
  combinable: boolean;
}

const EMPTY: Draft = {
  id: undefined,
  label: "",
  seats: "2",
  zone: "",
  isActive: true,
  combinable: false,
};

function toDraft(table: RestaurantTableForDay): Draft {
  return {
    id: table.id,
    label: table.label,
    seats: String(table.seats),
    zone: table.zone ?? "",
    isActive: table.isActive,
    combinable: table.combinable,
  };
}

/** Черновик брони: столик уже выбран, оператор задаёт время и гостя. */
interface BookingDraft {
  tableId: string;
  tableLabel: string;
  time: string;
  guestName: string;
  partySize: string;
}

export function TablesManager({
  tables,
  date,
  today,
  quickDays,
  canEdit,
}: {
  tables: RestaurantTableForDay[];
  date: string;
  today: string;
  quickDays: string[];
  canEdit: boolean;
}) {
  const { locale, t } = useI18n();
  const dateLocale = intlLocale(locale);
  const messages: Record<string, string> = {
    duplicate: t("tables.error.duplicate"),
    in_use: t("tables.error.in_use"),
    invalid: t("tables.error.invalid"),
    invalid_body: t("tables.error.invalid_body"),
    not_found: t("tables.error.not_found"),
    forbidden: t("menu.form.adminOnly"),
    unauthorized: t("common.sessionExpired"),
    network: t("common.networkError"),
    table_already_booked: t("tables.error.table_already_booked"),
    table_not_available: t("tables.error.table_not_available"),
    slot_in_past: t("tables.error.slot_in_past"),
  };
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [booking, setBooking] = useState<BookingDraft | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [bookingError, setBookingError] = useState<string | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | undefined>(undefined);

  // Прошедший день бронировать нельзя (это же правило держит `book_table_for_day`),
  // но смотреть — можно: так виден вчерашний зал.
  const dayIsPast = isPastDay(date, today);

  const zones = useMemo(
    () => [...new Set(tables.map((table) => table.zone).filter(Boolean))],
    [tables],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tables.filter((table) => {
      if (activeOnly && !table.isActive) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${table.label} ${table.zone ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [tables, query, activeOnly]);

  const seatsTotal = tables
    .filter((table) => table.isActive)
    .reduce((sum, table) => sum + table.seats, 0);
  const bookedCount = tables.filter((table) => table.bookedFrom).length;

  function show(message: string) {
    setToast(message);
    // Всплывающее сообщение живёт три секунды: оно подтверждает, а не информирует.
    setTimeout(() => setToast(undefined), 3000);
  }

  function goToDay(day: string) {
    router.push(`/tables?date=${day}`);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) {
      return;
    }

    const seats = Number(draft.seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 50) {
      setError(t("tables.error.seats"));
      return;
    }
    if (!draft.label.trim()) {
      setError(t("tables.error.label"));
      return;
    }

    setBusy(true);
    setError(undefined);

    const body = {
      label: draft.label,
      seats,
      zone: draft.zone,
      isActive: draft.isActive,
      combinable: draft.combinable,
    };
    const result = draft.id
      ? await apiSend(`/api/tables/${draft.id}`, "PATCH", body)
      : await apiSend("/api/tables", "POST", body);

    setBusy(false);
    if (!result.ok) {
      setError(messages[result.failure.code] ?? t("tables.error.save"));
      return;
    }

    setDraft(undefined);
    show(t("tables.saved", { label: body.label }));
    router.refresh();
  }

  async function remove(table: RestaurantTableForDay) {
    if (!window.confirm(t("tables.confirmDelete", { label: table.label }))) {
      return;
    }

    const result = await apiSend(`/api/tables/${table.id}`, "DELETE");
    if (!result.ok) {
      show(messages[result.failure.code] ?? t("tables.error.delete"));
      return;
    }
    show(t("tables.deleted", { label: table.label }));
    router.refresh();
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking) {
      return;
    }

    const partySize = Number(booking.partySize);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time)) {
      setBookingError(t("tables.error.time"));
      return;
    }
    if (!booking.guestName.trim()) {
      setBookingError(t("tables.error.guest"));
      return;
    }
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 100) {
      setBookingError(t("tables.error.party"));
      return;
    }

    setBusy(true);
    setBookingError(undefined);

    const result = await apiSend(
      `/api/tables/${booking.tableId}/booking`,
      "POST",
      {
        date,
        time: booking.time,
        guestName: booking.guestName,
        partySize,
      },
    );

    setBusy(false);
    if (!result.ok) {
      setBookingError(messages[result.failure.code] ?? t("tables.error.book"));
      return;
    }

    const label = booking.tableLabel;
    const time = booking.time;
    setBooking(undefined);
    show(t("tables.bookedToast", { label, time }));
    router.refresh();
  }

  async function cancelBooking(table: RestaurantTableForDay) {
    if (
      !window.confirm(
        t("tables.confirmCancel", {
          label: table.label,
          date: formatDayFull(date, dateLocale),
        }),
      )
    ) {
      return;
    }

    const result = await apiSend(
      `/api/tables/${table.id}/booking?date=${date}`,
      "DELETE",
    );
    if (!result.ok) {
      show(
        result.failure.code === "not_found"
          ? t("tables.error.bookingGone")
          : (messages[result.failure.code] ?? t("tables.error.cancel")),
      );
      return;
    }
    show(t("tables.cancelledToast", { label: table.label }));
    router.refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("tables.title")}</h1>
          <p>
            {t("tables.subtitle", { date: formatDayFull(date, dateLocale) })}
          </p>
        </div>
        {canEdit ? (
          <div className="page-head-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                setError(undefined);
                setDraft({ ...EMPTY });
              }}
            >
              {t("tables.add")}
            </button>
          </div>
        ) : null}
      </div>

      {dayIsPast ? <p className="notice">{t("tables.pastNotice")}</p> : null}

      {canEdit ? null : <p className="notice">{t("tables.operatorNotice")}</p>}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{tables.length}</span>
          <span className="stat-label">{t("tables.total")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {tables.filter((table) => table.isActive).length}
          </span>
          <span className="stat-label">{t("tables.active")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{bookedCount}</span>
          <span className="stat-label">{t("tables.booked")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{seatsTotal}</span>
          <span className="stat-label">{t("tables.activeSeats")}</span>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder={t("tables.searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label={t("tables.searchLabel")}
        />
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => setActiveOnly(event.currentTarget.checked)}
          />
          {t("tables.activeOnly")}
        </label>
        <span className="toolbar-count">
          {t("tables.shown", { visible: visible.length, total: tables.length })}
        </span>
      </div>

      <div className="day-bar">
        <span className="day-bar-label">{t("tables.day")}</span>
        <div className="day-chips">
          {quickDays.map((day) => (
            <button
              key={day}
              type="button"
              className={day === date ? "day-chip is-current" : "day-chip"}
              aria-current={day === date ? "date" : undefined}
              onClick={() => goToDay(day)}
            >
              {formatDayLabel(day, today, dateLocale)}
            </button>
          ))}
        </div>
        <label className="day-pick">
          <span>{t("tables.otherDay")}</span>
          <input
            type="date"
            value={date}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value) {
                goToDay(value);
              }
            }}
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <p>
              {tables.length === 0 ? t("tables.empty") : t("tables.noMatch")}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("tables.label")}</th>
                <th>{t("tables.zone")}</th>
                <th className="num">{t("tables.seats")}</th>
                <th>{t("tables.properties")}</th>
                <th>{t("tables.bookedFrom")}</th>
                <th>{t("tables.status")}</th>
                <th className="actions">{t("tables.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((table) => (
                <tr key={table.id} className={table.isActive ? "" : "is-off"}>
                  <td data-label={t("tables.label")}>
                    <span className="row-title">{table.label}</span>
                  </td>
                  <td data-label={t("tables.zone")}>{table.zone ?? "—"}</td>
                  <td data-label={t("tables.seats")} className="num">
                    {table.seats}
                  </td>
                  <td data-label={t("tables.properties")}>
                    {table.combinable ? (
                      <span className="badge on">{t("tables.combinable")}</span>
                    ) : (
                      <span className="badge off">{t("tables.separate")}</span>
                    )}
                  </td>
                  <td data-label={t("tables.bookedFrom")}>
                    {table.bookedFrom ? (
                      <>
                        <span className="row-title">{table.bookedFrom}</span>
                        <span className="row-sub">
                          {table.bookedGuestName},{" "}
                          {t("tables.people", {
                            count: table.bookedPartySize ?? 0,
                          })}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label={t("tables.status")}>
                    {!table.isActive ? (
                      <span className="badge off">{t("tables.disabled")}</span>
                    ) : table.bookedFrom ? (
                      <span className="badge busy">{t("tables.booked")}</span>
                    ) : (
                      <span className="badge on">{t("tables.free")}</span>
                    )}
                  </td>
                  <td data-label={t("tables.actions")} className="actions">
                    {dayIsPast || !table.isActive ? null : table.bookedFrom ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => cancelBooking(table)}
                      >
                        {t("tables.cancelBooking")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setBookingError(undefined);
                          setBooking({
                            tableId: table.id,
                            tableLabel: table.label,
                            time: "",
                            guestName: "",
                            partySize: String(table.seats),
                          });
                        }}
                      >
                        {t("tables.book")}
                      </button>
                    )}
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setError(undefined);
                            setDraft(toDraft(table));
                          }}
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => remove(table)}
                        >
                          {t("common.delete")}
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {booking ? (
        <Drawer
          title={t("tables.bookingTitle", { label: booking.tableLabel })}
          onClose={() => setBooking(undefined)}
          footer={
            <>
              <button
                type="submit"
                form="booking-form"
                className="primary"
                disabled={busy}
              >
                {busy ? t("tables.booking") : t("tables.book")}
              </button>
              <button type="button" onClick={() => setBooking(undefined)}>
                {t("common.cancel")}
              </button>
            </>
          }
        >
          <form id="booking-form" onSubmit={submitBooking}>
            {bookingError ? <p className="form-note">{bookingError}</p> : null}

            <div className="field-row">
              <label className="field">
                <span>{t("tables.time")}</span>
                <input
                  type="time"
                  value={booking.time}
                  onChange={(event) =>
                    setBooking({
                      ...booking,
                      time: event.currentTarget.value,
                    })
                  }
                  required
                />
              </label>
              <label className="field">
                <span>{t("tables.guests")}</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={booking.partySize}
                  onChange={(event) =>
                    setBooking({
                      ...booking,
                      partySize: event.currentTarget.value,
                    })
                  }
                  required
                />
              </label>
            </div>

            <label className="field">
              <span>{t("tables.guestName")}</span>
              <input
                value={booking.guestName}
                onChange={(event) =>
                  setBooking({
                    ...booking,
                    guestName: event.currentTarget.value,
                  })
                }
                maxLength={120}
                required
              />
            </label>

            <p className="field-hint">
              {t("tables.bookingHint", {
                date: formatDayFull(date, dateLocale),
              })}
            </p>
          </form>
        </Drawer>
      ) : null}

      {draft ? (
        <Drawer
          title={draft.id ? t("tables.editTitle") : t("tables.newTitle")}
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <button
                type="submit"
                form="table-form"
                className="primary"
                disabled={busy}
              >
                {busy ? t("common.saving") : t("common.save")}
              </button>
              <button type="button" onClick={() => setDraft(undefined)}>
                {t("common.cancel")}
              </button>
            </>
          }
        >
          <form id="table-form" onSubmit={save}>
            {error ? <p className="form-note">{error}</p> : null}

            <div className="field-row">
              <label className="field">
                <span>{t("tables.label")}</span>
                <input
                  value={draft.label}
                  onChange={(event) =>
                    setDraft({ ...draft, label: event.currentTarget.value })
                  }
                  maxLength={40}
                  required
                />
              </label>
              <label className="field">
                <span>{t("tables.seats")}</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.seats}
                  onChange={(event) =>
                    setDraft({ ...draft, seats: event.currentTarget.value })
                  }
                  required
                />
              </label>
            </div>

            <label className="field">
              <span>{t("tables.zone")}</span>
              <input
                value={draft.zone}
                onChange={(event) =>
                  setDraft({ ...draft, zone: event.currentTarget.value })
                }
                list="table-zones"
                maxLength={60}
                placeholder={t("tables.zonePlaceholder")}
              />
              <datalist id="table-zones">
                {zones.map((zone) => (
                  <option key={zone} value={zone ?? ""} />
                ))}
              </datalist>
              <p className="field-hint">{t("tables.zoneHint")}</p>
            </label>

            <fieldset className="field-group">
              <legend>{t("tables.properties")}</legend>
              <div className="switch-stack">
                <Toggle
                  label={t("tables.isActive")}
                  checked={draft.isActive}
                  onChange={(value) => setDraft({ ...draft, isActive: value })}
                />
                <Toggle
                  label={t("tables.isCombinable")}
                  checked={draft.combinable}
                  onChange={(value) =>
                    setDraft({ ...draft, combinable: value })
                  }
                />
              </div>
            </fieldset>
          </form>
        </Drawer>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
