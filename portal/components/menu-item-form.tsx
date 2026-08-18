"use client";

import { type FormEvent, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Toggle } from "@/components/ui/toggle";
import { apiSend } from "@/lib/client-api";
import type { MenuCategory, MenuItem } from "@/lib/menu";
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  type Allergen,
  centsToInput,
  LANGUAGES,
  type Language,
  parseEuros,
} from "@/lib/schemas/menu";

/**
 * Форма блюда. Три языка разведены по табам (PROJECT.md §7.3), аллергены — чипами
 * ровно из того списка, что разрешает CHECK в базе.
 */

export interface ItemDraft {
  id: string | undefined;
  categoryId: string;
  nameDe: string;
  nameRu: string;
  nameEn: string;
  descriptionDe: string;
  descriptionRu: string;
  descriptionEn: string;
  price: string;
  allergens: Allergen[];
  aliases: string[];
  isVegetarian: boolean;
  isVegan: boolean;
  isAvailable: boolean;
  prepMinutes: string;
}

export function emptyItem(categoryId: string): ItemDraft {
  return {
    id: undefined,
    categoryId,
    nameDe: "",
    nameRu: "",
    nameEn: "",
    descriptionDe: "",
    descriptionRu: "",
    descriptionEn: "",
    price: "0,00",
    allergens: [],
    aliases: [],
    isVegetarian: false,
    isVegan: false,
    isAvailable: true,
    prepMinutes: "15",
  };
}

export function toItemDraft(item: MenuItem): ItemDraft {
  return {
    id: item.id,
    categoryId: item.categoryId,
    nameDe: item.nameDe,
    nameRu: item.nameRu,
    nameEn: item.nameEn,
    descriptionDe: item.descriptionDe ?? "",
    descriptionRu: item.descriptionRu ?? "",
    descriptionEn: item.descriptionEn ?? "",
    price: centsToInput(item.priceCents),
    allergens: item.allergens,
    aliases: item.aliases,
    isVegetarian: item.isVegetarian,
    isVegan: item.isVegan,
    isAvailable: item.isAvailable,
    prepMinutes: String(item.prepMinutes),
  };
}

const MESSAGES: Record<string, string> = {
  invalid: "База отвергла значения. Проверьте поля.",
  invalid_body: "Проверьте заполнение полей.",
  not_found: "Категория или блюдо уже удалены. Обновите страницу.",
  forbidden: "Изменения доступны только администратору.",
  unauthorized: "Сессия истекла. Войдите заново.",
  network: "Сервер недоступен. Проверьте соединение.",
};

const LANGUAGE_NAMES: Record<Language, string> = {
  de: "немецкий",
  ru: "русский",
  en: "английский",
};

const NAME_FIELD = {
  de: "nameDe",
  ru: "nameRu",
  en: "nameEn",
} as const;

const DESCRIPTION_FIELD = {
  de: "descriptionDe",
  ru: "descriptionRu",
  en: "descriptionEn",
} as const;

export function ItemForm({
  draft: initial,
  categories,
  onClose,
  onSaved,
}: {
  draft: ItemDraft;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [lang, setLang] = useState<Language>("de");
  const [alias, setAlias] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  function toggleAllergen(allergen: Allergen, on: boolean) {
    setDraft({
      ...draft,
      allergens: on
        ? [...draft.allergens, allergen]
        : draft.allergens.filter((value) => value !== allergen),
    });
  }

  function addAlias() {
    const value = alias.trim();
    if (!value || draft.aliases.includes(value)) {
      setAlias("");
      return;
    }
    setDraft({ ...draft, aliases: [...draft.aliases, value] });
    setAlias("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const priceCents = parseEuros(draft.price);
    if (priceCents === undefined) {
      setError("Цена — число с двумя знаками после запятой, например 12,50.");
      return;
    }
    const prepMinutes = Number(draft.prepMinutes);
    if (
      !Number.isInteger(prepMinutes) ||
      prepMinutes < 0 ||
      prepMinutes > 240
    ) {
      setError("Время приготовления — целое число минут от 0 до 240.");
      return;
    }
    if (!draft.nameDe.trim() || !draft.nameRu.trim() || !draft.nameEn.trim()) {
      setError("Название нужно заполнить на всех трёх языках.");
      return;
    }

    setBusy(true);
    setError(undefined);

    const body = {
      categoryId: draft.categoryId,
      nameDe: draft.nameDe,
      nameRu: draft.nameRu,
      nameEn: draft.nameEn,
      descriptionDe: draft.descriptionDe,
      descriptionRu: draft.descriptionRu,
      descriptionEn: draft.descriptionEn,
      priceCents,
      allergens: draft.allergens,
      aliases: draft.aliases,
      isVegetarian: draft.isVegetarian,
      isVegan: draft.isVegan,
      isAvailable: draft.isAvailable,
      prepMinutes,
    };
    const result = draft.id
      ? await apiSend(`/api/menu/items/${draft.id}`, "PATCH", body)
      : await apiSend("/api/menu/items", "POST", body);

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.failure.code] ?? "Не удалось сохранить.");
      return;
    }
    onSaved(`Блюдо «${draft.nameRu}» сохранено`);
  }

  const missing = LANGUAGES.filter((code) => !draft[NAME_FIELD[code]].trim());

  return (
    <Drawer
      title={draft.id ? "Изменение блюда" : "Новое блюдо"}
      onClose={onClose}
      footer={
        <>
          <button
            type="submit"
            form="item-form"
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
      <form id="item-form" onSubmit={save}>
        {error ? <p className="form-note">{error}</p> : null}

        <label className="field">
          <span>Категория</span>
          <select
            value={draft.categoryId}
            onChange={(event) =>
              setDraft({ ...draft, categoryId: event.currentTarget.value })
            }
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.nameRu}
              </option>
            ))}
          </select>
        </label>

        <div className="lang-tabs" role="tablist" aria-label="Язык текстов">
          {LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={lang === code}
              onClick={() => setLang(code)}
            >
              {code}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Название, {LANGUAGE_NAMES[lang]}</span>
          <input
            value={draft[NAME_FIELD[lang]]}
            onChange={(event) =>
              setDraft({
                ...draft,
                [NAME_FIELD[lang]]: event.currentTarget.value,
              })
            }
            maxLength={120}
          />
        </label>

        <label className="field">
          <span>Описание, {LANGUAGE_NAMES[lang]}</span>
          <textarea
            value={draft[DESCRIPTION_FIELD[lang]]}
            onChange={(event) =>
              setDraft({
                ...draft,
                [DESCRIPTION_FIELD[lang]]: event.currentTarget.value,
              })
            }
            maxLength={600}
          />
          <p className="field-hint">Необязательно.</p>
        </label>

        {missing.length > 0 ? (
          <p className="field-hint">
            Название не заполнено:{" "}
            {missing.map((code) => LANGUAGE_NAMES[code]).join(", ")}.
          </p>
        ) : null}

        <div className="field-row">
          <label className="field">
            <span>Цена, €</span>
            <input
              inputMode="decimal"
              value={draft.price}
              onChange={(event) =>
                setDraft({ ...draft, price: event.currentTarget.value })
              }
              required
            />
          </label>
          <label className="field">
            <span>Готовится, мин</span>
            <input
              type="number"
              min={0}
              max={240}
              value={draft.prepMinutes}
              onChange={(event) =>
                setDraft({ ...draft, prepMinutes: event.currentTarget.value })
              }
              required
            />
          </label>
        </div>

        <fieldset className="field-group">
          <legend>Аллергены</legend>
          <div className="chip-row">
            {ALLERGENS.map((allergen) => (
              <label className="chip" key={allergen}>
                <input
                  type="checkbox"
                  checked={draft.allergens.includes(allergen)}
                  onChange={(event) =>
                    toggleAllergen(allergen, event.currentTarget.checked)
                  }
                />
                {ALLERGEN_LABELS[allergen]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Свойства</legend>
          <div className="switch-stack">
            <Toggle
              label="Вегетарианское"
              checked={draft.isVegetarian}
              // Веганское без вегетарианского база не примет (CHECK в миграции 003).
              disabled={draft.isVegan}
              onChange={(value) => setDraft({ ...draft, isVegetarian: value })}
            />
            <Toggle
              label="Веганское"
              checked={draft.isVegan}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  isVegan: value,
                  isVegetarian: value ? true : draft.isVegetarian,
                })
              }
            />
            <Toggle
              label="В продаже"
              checked={draft.isAvailable}
              onChange={(value) => setDraft({ ...draft, isAvailable: value })}
            />
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Синонимы для распознавания на слух</legend>
          <div className="tag-input">
            <input
              value={alias}
              onChange={(event) => setAlias(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Внутри формы Enter отправил бы её целиком.
                  event.preventDefault();
                  addAlias();
                }
              }}
              maxLength={60}
              placeholder="например, Pizza Salami"
            />
            <button type="button" onClick={addAlias}>
              Добавить
            </button>
          </div>
          {draft.aliases.length > 0 ? (
            <ul className="tag-list">
              {draft.aliases.map((value) => (
                <li className="tag" key={value}>
                  {value}
                  <button
                    type="button"
                    aria-label={`Убрать синоним ${value}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        aliases: draft.aliases.filter((item) => item !== value),
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="field-hint">
              По ним агент находит блюдо, когда гость называет его иначе.
            </p>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
