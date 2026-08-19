"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Toggle } from "@/components/ui/toggle";
import { apiSend } from "@/lib/client-api";
import { formatDayFull, formatDayLabel, isPastDay } from "@/lib/day";
import type { RestaurantTableForDay } from "@/lib/tables";

/**
 * Экран столиков. Данные приходят с сервера пропсом; после каждой удачной записи
 * вызывается `router.refresh()`, и серверный компонент перечитывает список — своей
 * копии состояния список не держит и рассинхронизироваться с базой не может.
 *
 * Выбранный день живёт в адресной строке, а не в состоянии: так ссылку на день можно
 * переслать, а перезагрузка страницы не сбрасывает выбор.
 */

const MESSAGES: Record<string, string> = {
  duplicate: "Столик с такой меткой уже есть.",
  in_use:
    "Столик участвует в бронях — удалить его нельзя, можно только выключить.",
  invalid: "База отвергла значения. Проверьте поля.",
  invalid_body: "Проверьте заполнение полей.",
  not_found: "Столик уже удалён. Обновите страницу.",
  forbidden: "Изменения доступны только администратору.",
  unauthorized: "Сессия истекла. Войдите заново.",
  network: "Сервер недоступен. Проверьте соединение.",
  table_already_booked:
    "Столик на этот день уже забронирован. Обновите страницу.",
  table_not_available: "Столик недоступен: он выключен или уже удалён.",
  slot_in_past: "Этот день уже прошёл — бронировать нельзя.",
};

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
      setError("Число мест — целое от 1 до 50.");
      return;
    }
    if (!draft.label.trim()) {
      setError("Укажите метку столика.");
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
      setError(MESSAGES[result.failure.code] ?? "Не удалось сохранить.");
      return;
    }

    setDraft(undefined);
    show(body.label ? `Столик ${body.label} сохранён` : "Столик сохранён");
    router.refresh();
  }

  async function remove(table: RestaurantTableForDay) {
    if (
      !window.confirm(
        `Удалить столик ${table.label}? Действие необратимо. Если он участвовал в бронях, база не даст его удалить — тогда выключите столик.`,
      )
    ) {
      return;
    }

    const result = await apiSend(`/api/tables/${table.id}`, "DELETE");
    if (!result.ok) {
      show(MESSAGES[result.failure.code] ?? "Не удалось удалить.");
      return;
    }
    show(`Столик ${table.label} удалён`);
    router.refresh();
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!booking) {
      return;
    }

    const partySize = Number(booking.partySize);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(booking.time)) {
      setBookingError("Укажите время в формате ЧЧ:ММ.");
      return;
    }
    if (!booking.guestName.trim()) {
      setBookingError("Укажите имя гостя.");
      return;
    }
    if (!Number.isInteger(partySize) || partySize < 1 || partySize > 100) {
      setBookingError("Число гостей — целое от 1 до 100.");
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
      setBookingError(
        MESSAGES[result.failure.code] ?? "Не удалось забронировать.",
      );
      return;
    }

    const label = booking.tableLabel;
    const time = booking.time;
    setBooking(undefined);
    show(`Столик ${label} забронирован с ${time}`);
    router.refresh();
  }

  async function cancelBooking(table: RestaurantTableForDay) {
    if (
      !window.confirm(
        `Снять бронь со столика ${table.label} на ${formatDayFull(date)}?`,
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
          ? "Брони уже нет. Обновите страницу."
          : (MESSAGES[result.failure.code] ?? "Не удалось снять бронь."),
      );
      return;
    }
    show(`Бронь столика ${table.label} снята`);
    router.refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Столики</h1>
          <p>
            Зал на {formatDayFull(date)}: метки, вместимость и брони этого дня.
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
              Добавить столик
            </button>
          </div>
        ) : null}
      </div>

      {dayIsPast ? (
        <p className="notice">
          Этот день уже прошёл: брони показаны для справки, менять их нельзя.
        </p>
      ) : null}

      {canEdit ? null : (
        <p className="notice">
          Бронировать и снимать брони может и оператор. Добавлять, изменять и
          удалять сами столики — только администратор.
        </p>
      )}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{tables.length}</span>
          <span className="stat-label">столиков всего</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {tables.filter((table) => table.isActive).length}
          </span>
          <span className="stat-label">активных</span>
        </div>
        <div className="stat">
          <span className="stat-value">{bookedCount}</span>
          <span className="stat-label">забронировано</span>
        </div>
        <div className="stat">
          <span className="stat-value">{seatsTotal}</span>
          <span className="stat-label">мест в активных</span>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Поиск по метке или зоне"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          aria-label="Поиск столиков"
        />
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => setActiveOnly(event.currentTarget.checked)}
          />
          только активные
        </label>
        <span className="toolbar-count">
          показано: {visible.length} из {tables.length}
        </span>
      </div>

      <div className="day-bar">
        <span className="day-bar-label">День</span>
        <div className="day-chips">
          {quickDays.map((day) => (
            <button
              key={day}
              type="button"
              className={day === date ? "day-chip is-current" : "day-chip"}
              aria-current={day === date ? "date" : undefined}
              onClick={() => goToDay(day)}
            >
              {formatDayLabel(day, today)}
            </button>
          ))}
        </div>
        <label className="day-pick">
          <span>Другой день</span>
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
              {tables.length === 0
                ? "Столиков пока нет. Без них агент не сможет предложить время."
                : "Под фильтр ничего не подошло."}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Метка</th>
                <th>Зона</th>
                <th className="num">Мест</th>
                <th>Свойства</th>
                <th>Бронь с</th>
                <th>Статус</th>
                <th className="actions">Действия</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((table) => (
                <tr key={table.id} className={table.isActive ? "" : "is-off"}>
                  <td data-label="Метка">
                    <span className="row-title">{table.label}</span>
                  </td>
                  <td data-label="Зона">{table.zone ?? "—"}</td>
                  <td data-label="Мест" className="num">
                    {table.seats}
                  </td>
                  <td data-label="Свойства">
                    {table.combinable ? (
                      <span className="badge on">объединяемый</span>
                    ) : (
                      <span className="badge off">отдельный</span>
                    )}
                  </td>
                  <td data-label="Бронь с">
                    {table.bookedFrom ? (
                      <>
                        <span className="row-title">{table.bookedFrom}</span>
                        <span className="row-sub">
                          {table.bookedGuestName}, {table.bookedPartySize} чел.
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Статус">
                    {!table.isActive ? (
                      <span className="badge off">выключен</span>
                    ) : table.bookedFrom ? (
                      <span className="badge busy">забронирован</span>
                    ) : (
                      <span className="badge on">свободен</span>
                    )}
                  </td>
                  <td data-label="Действия" className="actions">
                    {dayIsPast || !table.isActive ? null : table.bookedFrom ? (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => cancelBooking(table)}
                      >
                        Снять бронь
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
                        Забронировать
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
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => remove(table)}
                        >
                          Удалить
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
          title={`Бронь столика ${booking.tableLabel}`}
          onClose={() => setBooking(undefined)}
          footer={
            <>
              <button
                type="submit"
                form="booking-form"
                className="primary"
                disabled={busy}
              >
                {busy ? "Бронирую…" : "Забронировать"}
              </button>
              <button type="button" onClick={() => setBooking(undefined)}>
                Отмена
              </button>
            </>
          }
        >
          <form id="booking-form" onSubmit={submitBooking}>
            {bookingError ? <p className="form-note">{bookingError}</p> : null}

            <div className="field-row">
              <label className="field">
                <span>Время</span>
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
                <span>Гостей</span>
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
              <span>Имя гостя</span>
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
              {formatDayFull(date)}: столик будет занят с указанного времени и
              до конца дня. Голосовой агент этот столик гостям больше не
              предложит.
            </p>
          </form>
        </Drawer>
      ) : null}

      {draft ? (
        <Drawer
          title={draft.id ? "Изменение столика" : "Новый столик"}
          onClose={() => setDraft(undefined)}
          footer={
            <>
              <button
                type="submit"
                form="table-form"
                className="primary"
                disabled={busy}
              >
                {busy ? "Сохраняю…" : "Сохранить"}
              </button>
              <button type="button" onClick={() => setDraft(undefined)}>
                Отмена
              </button>
            </>
          }
        >
          <form id="table-form" onSubmit={save}>
            {error ? <p className="form-note">{error}</p> : null}

            <div className="field-row">
              <label className="field">
                <span>Метка</span>
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
                <span>Мест</span>
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
              <span>Зона</span>
              <input
                value={draft.zone}
                onChange={(event) =>
                  setDraft({ ...draft, zone: event.currentTarget.value })
                }
                list="table-zones"
                maxLength={60}
                placeholder="например, Terrasse"
              />
              <datalist id="table-zones">
                {zones.map((zone) => (
                  <option key={zone} value={zone ?? ""} />
                ))}
              </datalist>
              <p className="field-hint">
                Необязательно. Зона помогает агенту предложить гостю террасу или
                зал.
              </p>
            </label>

            <fieldset className="field-group">
              <legend>Свойства</legend>
              <div className="switch-stack">
                <Toggle
                  label="Активен — участвует в подборе времени"
                  checked={draft.isActive}
                  onChange={(value) => setDraft({ ...draft, isActive: value })}
                />
                <Toggle
                  label="Объединяемый — можно сдвинуть с соседним"
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
