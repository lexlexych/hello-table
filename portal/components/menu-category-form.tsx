"use client";

import { type FormEvent, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
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

export function CategoryForm({
  draft: initial,
  onClose,
  onSaved,
}: {
  draft: CategoryDraft;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { locale, t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const sortOrder = Number(draft.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
      setError(t("menu.form.orderInvalid"));
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
      const errors: Record<string, string> = {
        duplicate: t("menu.form.duplicate"),
        invalid: t("menu.form.invalid"),
        invalid_body: t("menu.form.invalidNames"),
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
    onSaved(t("menu.form.categorySaved", { name }));
  }

  return (
    <Drawer
      title={
        draft.id ? t("menu.form.editCategory") : t("menu.form.newCategory")
      }
      onClose={onClose}
      footer={
        <>
          <button
            type="submit"
            form="category-form"
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
      <form id="category-form" onSubmit={save}>
        {error ? <p className="form-note">{error}</p> : null}

        <label className="field">
          <span>{t("menu.form.nameDe")}</span>
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
          <span>{t("menu.form.nameRu")}</span>
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
          <span>{t("menu.form.nameEn")}</span>
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
          <span>{t("menu.form.sortOrder")}</span>
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
          <p className="field-hint">{t("menu.form.sortHint")}</p>
        </label>
      </form>
    </Drawer>
  );
}
