"use client";

import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Drawer } from "@/components/ui/drawer";
import { apiSend } from "@/lib/client-api";
import { intlLocale } from "@/lib/i18n/catalog";
import { formatEuros } from "@/lib/schemas/menu";

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
  const { locale, t } = useI18n();
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
      setError(t("pickup.form.guestRequired"));
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError(t("pickup.form.timeFormat"));
      return;
    }
    // Та же проверка стоит в zod-схеме маршрута; здесь она нужна, чтобы оператор
    // узнал о сетке до похода в базу, а не из общего отказа `slot_full`.
    if (Number(time.slice(3)) % SLOT_MINUTES !== 0) {
      setError(t("pickup.form.timeStep"));
      return;
    }
    if (lines.length === 0) {
      setError(t("pickup.form.itemRequired"));
      return;
    }
    const quantities = lines.map((line) => Number(line.quantity));
    if (
      quantities.some(
        (quantity) =>
          !Number.isInteger(quantity) || quantity < 1 || quantity > 50,
      )
    ) {
      setError(t("pickup.form.quantityInvalid"));
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
      const errors: Record<string, string> = {
        slot_full: t("pickup.error.slot_full"),
        pickup_too_early: t("pickup.error.pickup_too_early"),
        no_pickup_slot: t("pickup.error.no_pickup_slot"),
        item_unavailable: t("pickup.error.item_unavailable"),
        empty_order: t("pickup.error.empty_order"),
        invalid_quantity: t("pickup.error.invalid_quantity"),
        order_number_exhausted: t("pickup.error.order_number_exhausted"),
        restaurant_not_found: t("pickup.error.restaurant_not_found"),
        duplicate: t("pickup.error.duplicate"),
        invalid: t("pickup.error.invalid"),
        invalid_body: t("pickup.error.invalid_body"),
        not_found: t("pickup.error.not_found"),
        forbidden: t("common.forbidden"),
        unauthorized: t("common.sessionExpired"),
        network: t("common.networkError"),
      };
      setError(errors[result.failure.code] ?? t("pickup.form.failed"));
      return;
    }

    const created = result.data;
    onCreated(
      created
        ? t("pickup.form.created", {
            number: created.orderNumber,
            time: created.readyAtLocal,
            total: formatEuros(created.totalCents, intlLocale(locale)),
          })
        : t("pickup.form.createdShort"),
    );
  }

  return (
    <Drawer
      title={t("pickup.form.title")}
      onClose={onClose}
      footer={
        <>
          <button
            type="submit"
            form="pickup-form"
            className="primary"
            disabled={busy || menu.length === 0}
          >
            {busy ? t("pickup.form.creating") : t("pickup.form.create")}
          </button>
          <button type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      {menu.length === 0 ? (
        <p className="form-note">{t("pickup.form.noMenu")}</p>
      ) : (
        <form id="pickup-form" onSubmit={submit}>
          <div className="field-row">
            <label className="field">
              <span>{t("pickup.form.guest")}</span>
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="field">
              <span>{t("pickup.form.phone")}</span>
              <input
                value={guestPhone}
                onChange={(event) => setGuestPhone(event.target.value)}
                maxLength={40}
                inputMode="tel"
              />
            </label>
          </div>

          <label className="field">
            <span>{t("pickup.form.time")}</span>
            {/* step=900 даёт шаг в 15 минут в браузерном выборе времени. */}
            <input
              type="time"
              step={SLOT_MINUTES * 60}
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
            />
            <span className="field-hint">{t("pickup.form.timeHint")}</span>
          </label>

          <div className="field-group">
            <div className="panel-head">
              <h3>{t("pickup.form.items")}</h3>
              <button type="button" className="ghost" onClick={addLine}>
                {t("pickup.form.addItem")}
              </button>
            </div>

            {lines.map((line) => (
              <div className="order-line-edit" key={line.key}>
                <label className="field">
                  <span>{t("pickup.form.item")}</span>
                  <select
                    value={line.menuItemId}
                    onChange={(event) =>
                      patchLine(line.key, { menuItemId: event.target.value })
                    }
                  >
                    {menu.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} —{" "}
                        {formatEuros(item.priceCents, intlLocale(locale))}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field field-narrow">
                  <span>{t("pickup.form.quantity")}</span>
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
                  <span>{t("pickup.form.note")}</span>
                  <input
                    value={line.note}
                    onChange={(event) =>
                      patchLine(line.key, { note: event.target.value })
                    }
                    maxLength={200}
                    placeholder={t("pickup.form.notePlaceholder")}
                  />
                </label>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() =>
                    setLines(lines.filter((other) => other.key !== line.key))
                  }
                  disabled={lines.length === 1}
                  aria-label={t("pickup.form.removeItem")}
                >
                  ×
                </button>
              </div>
            ))}

            <p className="order-total">
              {t("pickup.form.estimate", {
                total: formatEuros(total, intlLocale(locale)),
              })}
            </p>
          </div>

          {error ? <p className="form-error">{error}</p> : null}
        </form>
      )}
    </Drawer>
  );
}
