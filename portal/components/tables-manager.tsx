"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Toggle } from "@/components/ui/toggle";
import { apiSend } from "@/lib/client-api";
import type { RestaurantTable } from "@/lib/tables";

/**
 * Экран столиков. Данные приходят с сервера пропсом; после каждой удачной записи
 * вызывается `router.refresh()`, и серверный компонент перечитывает список — своей
 * копии состояния список не держит и рассинхронизироваться с базой не может.
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

function toDraft(table: RestaurantTable): Draft {
  return {
    id: table.id,
    label: table.label,
    seats: String(table.seats),
    zone: table.zone ?? "",
    isActive: table.isActive,
    combinable: table.combinable,
  };
}

export function TablesManager({
  tables,
  canEdit,
}: {
  tables: RestaurantTable[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | undefined>(undefined);

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

  function show(message: string) {
    setToast(message);
    // Всплывающее сообщение живёт три секунды: оно подтверждает, а не информирует.
    setTimeout(() => setToast(undefined), 3000);
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

  async function remove(table: RestaurantTable) {
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Столики</h1>
          <p>
            Зал ресторана: метки, вместимость и зоны для подбора при
            бронировании.
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

      {canEdit ? null : (
        <p className="notice">
          Режим просмотра: добавлять, изменять и удалять столики может только
          администратор.
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
                <th>Статус</th>
                {canEdit ? <th className="actions">Действия</th> : null}
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
                  <td data-label="Статус">
                    {table.isActive ? (
                      <span className="badge on">активен</span>
                    ) : (
                      <span className="badge off">выключен</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td data-label="Действия" className="actions">
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
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
