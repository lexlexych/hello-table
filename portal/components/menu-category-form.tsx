"use client";

import { type FormEvent, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { apiSend } from "@/lib/client-api";
import type { MenuCategory } from "@/lib/menu";

/**
 * Форма категории. Все три языка обязательны: агент разговаривает на любом из них
 * (PROJECT.md §4), и пропуск одного означает, что часть гостей услышит пустоту.
 */

export interface CategoryDraft {
  id: string | undefined;
  nameDe: string;
  nameRu: string;
  nameEn: string;
  sortOrder: string;
}

export const EMPTY_CATEGORY: CategoryDraft = {
  id: undefined,
  nameDe: "",
  nameRu: "",
  nameEn: "",
  sortOrder: "0",
};

export function toCategoryDraft(category: MenuCategory): CategoryDraft {
  return {
    id: category.id,
    nameDe: category.nameDe,
    nameRu: category.nameRu,
    nameEn: category.nameEn,
    sortOrder: String(category.sortOrder),
  };
}

const MESSAGES: Record<string, string> = {
  duplicate: "Категория с таким немецким названием уже есть.",
  invalid: "База отвергла значения. Проверьте поля.",
  invalid_body: "Заполните название на всех трёх языках.",
  not_found: "Категория уже удалена. Обновите страницу.",
  forbidden: "Изменения доступны только администратору.",
  unauthorized: "Сессия истекла. Войдите заново.",
  network: "Сервер недоступен. Проверьте соединение.",
};

export function CategoryForm({
  draft: initial,
  onClose,
  onSaved,
}: {
  draft: CategoryDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const sortOrder = Number(draft.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
      setError("Порядок — целое число от 0 до 999.");
      return;
    }

    setBusy(true);
    setError(undefined);

    const body = {
      nameDe: draft.nameDe,
      nameRu: draft.nameRu,
      nameEn: draft.nameEn,
      sortOrder,
    };
    const result = draft.id
      ? await apiSend(`/api/menu/categories/${draft.id}`, "PATCH", body)
      : await apiSend("/api/menu/categories", "POST", body);

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.failure.code] ?? "Не удалось сохранить.");
      return;
    }
    onSaved(`Категория «${draft.nameRu}» сохранена`);
  }

  return (
    <Drawer
      title={draft.id ? "Изменение категории" : "Новая категория"}
      onClose={onClose}
      footer={
        <>
          <button
            type="submit"
            form="category-form"
            className="primary"
            disabled={busy}
          >
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
          <button type="button" onClick={onClose}>
            Отмена
          </button>
        </>
      }
    >
      <form id="category-form" onSubmit={save}>
        {error ? <p className="form-note">{error}</p> : null}

        <label className="field">
          <span>Название, немецкий</span>
          <input
            value={draft.nameDe}
            onChange={(event) =>
              setDraft({ ...draft, nameDe: event.currentTarget.value })
            }
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>Название, русский</span>
          <input
            value={draft.nameRu}
            onChange={(event) =>
              setDraft({ ...draft, nameRu: event.currentTarget.value })
            }
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>Название, английский</span>
          <input
            value={draft.nameEn}
            onChange={(event) =>
              setDraft({ ...draft, nameEn: event.currentTarget.value })
            }
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>Порядок в меню</span>
          <input
            type="number"
            min={0}
            max={999}
            value={draft.sortOrder}
            onChange={(event) =>
              setDraft({ ...draft, sortOrder: event.currentTarget.value })
            }
            required
          />
          <p className="field-hint">Меньше — выше в списке.</p>
        </label>
      </form>
    </Drawer>
  );
}
