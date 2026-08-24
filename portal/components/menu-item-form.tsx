"use client";

import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Drawer } from "@/components/ui/drawer";
import { Toggle } from "@/components/ui/toggle";
import { apiSend } from "@/lib/client-api";
import type { MenuCategory, MenuItem } from "@/lib/menu";
import {
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
  const { locale, t } = useI18n();
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
      setError(t("menu.form.priceInvalid"));
      return;
    }
    const prepMinutes = Number(draft.prepMinutes);
    if (
      !Number.isInteger(prepMinutes) ||
      prepMinutes < 0 ||
      prepMinutes > 240
    ) {
      setError(t("menu.form.prepInvalid"));
      return;
    }
    if (!draft.nameDe.trim() || !draft.nameRu.trim() || !draft.nameEn.trim()) {
      setError(t("menu.form.namesRequired"));
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
      const errors: Record<string, string> = {
        invalid: t("menu.form.invalid"),
        invalid_body: t("menu.form.invalid"),
        not_found: t("menu.form.notFound"),
        forbidden: t("menu.form.adminOnly"),
        unauthorized: t("common.sessionExpired"),
        network: t("common.networkError"),
      };
      setError(errors[result.failure.code] ?? t("menu.form.failed"));
      return;
    }
    const name =
      locale === "de"
        ? draft.nameDe
        : locale === "en"
          ? draft.nameEn
          : draft.nameRu;
    onSaved(t("menu.form.itemSaved", { name }));
  }

  const missing = LANGUAGES.filter((code) => !draft[NAME_FIELD[code]].trim());

  return (
    <Drawer
      title={draft.id ? t("menu.form.editItem") : t("menu.form.newItem")}
      onClose={onClose}
      footer={
        <>
          <button
            type="submit"
            form="item-form"
            className="primary"
            disabled={busy}
          >
            {busy ? t("common.saving") : t("common.save")}
          </button>
          <button type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={save}>
        {error ? <p className="form-note">{error}</p> : null}

        <label className="field">
          <span>{t("menu.form.category")}</span>
          <select
            value={draft.categoryId}
            onChange={(event) =>
              setDraft({ ...draft, categoryId: event.currentTarget.value })
            }
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {locale === "de"
                  ? category.nameDe
                  : locale === "en"
                    ? category.nameEn
                    : category.nameRu}
              </option>
            ))}
          </select>
        </label>

        <div
          className="lang-tabs"
          role="tablist"
          aria-label={t("menu.form.textLanguage")}
        >
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
          <span>
            {t("menu.form.name", { language: t(`menu.form.language.${lang}`) })}
          </span>
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
          <span>
            {t("menu.form.description", {
              language: t(`menu.form.language.${lang}`),
            })}
          </span>
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
          <p className="field-hint">{t("menu.form.optional")}</p>
        </label>

        {missing.length > 0 ? (
          <p className="field-hint">
            {t("menu.form.missingNames", {
              languages: missing
                .map((code) => t(`menu.form.language.${code}`))
                .join(", "),
            })}
          </p>
        ) : null}

        <div className="field-row">
          <label className="field">
            <span>{t("menu.form.price")}</span>
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
            <span>{t("menu.form.prep")}</span>
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
          <legend>{t("menu.form.allergens")}</legend>
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
                {t(`allergen.${allergen}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>{t("menu.form.properties")}</legend>
          <div className="switch-stack">
            <Toggle
              label={t("menu.form.isVegetarian")}
              checked={draft.isVegetarian}
              // Веганское без вегетарианского база не примет (CHECK в миграции 003).
              disabled={draft.isVegan}
              onChange={(value) => setDraft({ ...draft, isVegetarian: value })}
            />
            <Toggle
              label={t("menu.form.isVegan")}
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
              label={t("menu.form.isAvailable")}
              checked={draft.isAvailable}
              onChange={(value) => setDraft({ ...draft, isAvailable: value })}
            />
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>{t("menu.form.aliases")}</legend>
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
              placeholder={t("menu.form.aliasPlaceholder")}
            />
            <button type="button" onClick={addAlias}>
              {t("common.add")}
            </button>
          </div>
          {draft.aliases.length > 0 ? (
            <ul className="tag-list">
              {draft.aliases.map((value) => (
                <li className="tag" key={value}>
                  {value}
                  <button
                    type="button"
                    aria-label={t("menu.form.removeAlias", { value })}
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
            <p className="field-hint">{t("menu.form.aliasHint")}</p>
          )}
        </fieldset>
      </form>
    </Drawer>
  );
}
