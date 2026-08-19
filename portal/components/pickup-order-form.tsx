"use client";

import { type FormEvent, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { apiSend } from "@/lib/client-api";
import { formatEuros } from "@/lib/schemas/menu";
import { PICKUP_MESSAGES } from "@/lib/schemas/pickup";

/**
 * Форма заказа на самовывоз. Собирает корзину из доступных блюд, имя гостя и время
 * выдачи; всё остальное считает база (`create_pickup_order_atomic`): сумму, цены
 * позиций, номер заказа и допустимость слота.
 *
 * Сумма на экране — подсказка по текущему прайсу, а не обещание. Авторитетная сумма
 * приходит в ответе базы и показывается в подтверждении.
 */

/** Блюдо, доступное для заказа. Приходит со страницы, уже отфильтровано по is_available. */
export interface PickupMenuItem {
  id: string;
  name: string;
  priceCents: number;
}

interface Line {
  /** Ключ строки формы. Одно и то же блюдо можно добавить дважды с разными пометками. */
  key: number;
  menuItemId: string;
  quantity: string;
  note: string;
}

/** Минимальный шаг сетки выдачи — его требует `pickup_slot_is_free` в базе. */
const SLOT_MINUTES = 15;

/**
 * Время по умолчанию: ближайший слот сетки не раньше чем через час. Час, а не
 * `pickup_lead_minutes`, потому что настройка ресторана порталу здесь неизвестна, а
 * промахнуться в большую сторону безопаснее — база отвергает только слишком раннее.
 */
function defaultTime(now: Date = new Date()): string {
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const minutes = later.getMinutes();
  later.setMinutes(
    minutes + ((SLOT_MINUTES - (minutes % SLOT_MINUTES)) % SLOT_MINUTES),
    0,
    0,
  );
  return `${String(later.getHours()).padStart(2, "0")}:${String(later.getMinutes()).padStart(2, "0")}`;
}

export function PickupOrderForm({
  menu,
  onClose,
  onCreated,
}: {
  menu: PickupMenuItem[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const first = menu[0];
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [time, setTime] = useState(defaultTime);
  const [lines, setLines] = useState<Line[]>(
    first ? [{ key: 1, menuItemId: first.id, quantity: "1", note: "" }] : [],
  );
  const [nextKey, setNextKey] = useState(2);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const total = lines.reduce((sum, line) => {
    const item = menu.find((candidate) => candidate.id === line.menuItemId);
    const quantity = Number(line.quantity);
    return item && Number.isInteger(quantity) && quantity > 0
      ? sum + item.priceCents * quantity
      : sum;
  }, 0);

  function addLine() {
    if (!first) {
      return;
    }
    setLines([
      ...lines,
      { key: nextKey, menuItemId: first.id, quantity: "1", note: "" },
    ]);
    setNextKey(nextKey + 1);
  }

  function patchLine(key: number, patch: Partial<Line>) {
    setLines(
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!guestName.trim()) {
      setError("Укажите имя гостя.");
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError("Укажите время в формате ЧЧ:ММ.");
      return;
    }
    // Та же проверка стоит в zod-схеме маршрута; здесь она нужна, чтобы оператор
    // узнал о сетке до похода в базу, а не из общего отказа `slot_full`.
    if (Number(time.slice(3)) % SLOT_MINUTES !== 0) {
      setError("Время выдачи кратно 15 минутам: 00, 15, 30 или 45.");
      return;
    }
    if (lines.length === 0) {
      setError("Добавьте хотя бы одно блюдо.");
      return;
    }
    const quantities = lines.map((line) => Number(line.quantity));
    if (
      quantities.some(
        (quantity) =>
          !Number.isInteger(quantity) || quantity < 1 || quantity > 50,
      )
    ) {
      setError("Количество каждого блюда — целое число от 1 до 50.");
      return;
    }

    setBusy(true);
    setError(undefined);
    const result = await apiSend<{
      orderNumber: string;
      totalCents: number;
      readyAtLocal: string;
    }>("/api/pickup", "POST", {
      time,
      guestName,
      guestPhone,
      items: lines.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: Number(line.quantity),
        note: line.note,
      })),
    });
    setBusy(false);

    if (!result.ok) {
      setError(
        PICKUP_MESSAGES[result.failure.code] ?? "Не удалось создать заказ.",
      );
      return;
    }

    const created = result.data;
    onCreated(
      created
        ? `Заказ № ${created.orderNumber} на ${created.readyAtLocal}, ${formatEuros(created.totalCents)}`
        : "Заказ создан",
    );
  }

  return (
    <Drawer
      title="Новый заказ на самовывоз"
      onClose={onClose}
      footer={
        <>
          <button
            type="submit"
            form="pickup-form"
            className="primary"
            disabled={busy || menu.length === 0}
          >
            {busy ? "Создаю…" : "Создать заказ"}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </>
      }
    >
      {menu.length === 0 ? (
        <p className="form-note">
          В меню нет ни одного доступного блюда — заказ собрать не из чего.
        </p>
      ) : (
        <form id="pickup-form" onSubmit={submit}>
          <div className="field-row">
            <label className="field">
              <span>Имя гостя</span>
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="field">
              <span>Телефон (необязательно)</span>
              <input
                value={guestPhone}
                onChange={(event) => setGuestPhone(event.target.value)}
                maxLength={40}
                inputMode="tel"
              />
            </label>
          </div>

          <label className="field">
            <span>Время выдачи</span>
            {/* step=900 даёт шаг в 15 минут в браузерном выборе времени. */}
            <input
              type="time"
              step={SLOT_MINUTES * 60}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
            <span className="field-hint">
              Только сегодня, кратно 15 минутам. Слишком раннее время база
              отклонит.
            </span>
          </label>

          <div className="field-group">
            <div className="panel-head">
              <h3>Блюда</h3>
              <button type="button" className="ghost" onClick={addLine}>
                Добавить блюдо
              </button>
            </div>

            {lines.map((line) => (
              <div className="order-line-edit" key={line.key}>
                <label className="field">
                  <span>Блюдо</span>
                  <select
                    value={line.menuItemId}
                    onChange={(event) =>
                      patchLine(line.key, { menuItemId: event.target.value })
                    }
                  >
                    {menu.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} — {formatEuros(item.priceCents)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field-narrow">
                  <span>Кол-во</span>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={line.quantity}
                    onChange={(event) =>
                      patchLine(line.key, { quantity: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Пометка</span>
                  <input
                    value={line.note}
                    onChange={(event) =>
                      patchLine(line.key, { note: event.target.value })
                    }
                    maxLength={200}
                    placeholder="например, без лука"
                  />
                </label>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() =>
                    setLines(lines.filter((other) => other.key !== line.key))
                  }
                  disabled={lines.length === 1}
                  aria-label="Убрать блюдо"
                >
                  ×
                </button>
              </div>
            ))}

            <p className="order-total">Предварительно: {formatEuros(total)}</p>
          </div>

          {error ? <p className="form-error">{error}</p> : null}
        </form>
      )}
    </Drawer>
  );
}
