"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import {
  type CategoryDraft,
  CategoryForm,
  EMPTY_CATEGORY,
  toCategoryDraft,
} from "@/components/menu-category-form";
import {
  emptyItem,
  type ItemDraft,
  ItemForm,
  toItemDraft,
} from "@/components/menu-item-form";
import { apiSend } from "@/lib/client-api";
import { intlLocale } from "@/lib/i18n/catalog";
import type { MenuCategory, MenuItem } from "@/lib/menu";
import { formatEuros } from "@/lib/schemas/menu";

/**
 * Экран меню: слева категории, справа блюда выбранной категории. Данные приходят
 * с сервера, после записи страница перечитывается через `router.refresh()`.
 */

export function MenuManager({
  categories,
  items,
  canEdit,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  canEdit: boolean;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const categoryName = (category: MenuCategory) =>
    locale === "de"
      ? category.nameDe
      : locale === "en"
        ? category.nameEn
        : category.nameRu;
  const itemName = (item: MenuItem) =>
    locale === "de" ? item.nameDe : locale === "en" ? item.nameEn : item.nameRu;
  const otherItemNames = (item: MenuItem) =>
    locale === "de"
      ? `${item.nameRu} / ${item.nameEn}`
      : locale === "en"
        ? `${item.nameDe} / ${item.nameRu}`
        : `${item.nameDe} / ${item.nameEn}`;
  const deleteMessages: Record<string, string> = {
    not_found: t("menu.deletedAlready"),
    forbidden: t("menu.adminDelete"),
    unauthorized: t("common.sessionExpired"),
    network: t("common.networkError"),
  };
  const [selected, setSelected] = useState<string | undefined>(
    categories[0]?.id,
  );
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | undefined>(
    undefined,
  );
  const [itemDraft, setItemDraft] = useState<ItemDraft | undefined>(undefined);
  const [toast, setToast] = useState<string | undefined>(undefined);

  // Категория могла исчезнуть после обновления списка — тогда берём первую.
  const current =
    categories.find((category) => category.id === selected) ?? categories[0];

  const countByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const visible = useMemo(
    () => items.filter((item) => item.categoryId === current?.id),
    [items, current],
  );

  function show(message: string) {
    setToast(message);
    setTimeout(() => setToast(undefined), 3000);
  }

  function saved(message: string) {
    setCategoryDraft(undefined);
    setItemDraft(undefined);
    show(message);
    router.refresh();
  }

  async function removeCategory(category: MenuCategory) {
    const count = countByCategory.get(category.id) ?? 0;
    if (count > 0) {
      show(t("menu.categoryHasItems", { name: categoryName(category), count }));
      return;
    }
    if (
      !window.confirm(
        t("menu.confirmDeleteCategory", { name: categoryName(category) }),
      )
    ) {
      return;
    }

    const result = await apiSend(
      `/api/menu/categories/${category.id}`,
      "DELETE",
    );
    if (!result.ok) {
      show(
        result.failure.code === "in_use"
          ? t("menu.categoryInUse")
          : (deleteMessages[result.failure.code] ?? t("menu.deleteFailed")),
      );
      return;
    }
    show(t("menu.categoryDeleted", { name: categoryName(category) }));
    router.refresh();
  }

  async function removeItem(item: MenuItem) {
    if (
      !window.confirm(t("menu.confirmDeleteItem", { name: itemName(item) }))
    ) {
      return;
    }

    const result = await apiSend(`/api/menu/items/${item.id}`, "DELETE");
    if (!result.ok) {
      show(
        result.failure.code === "in_use"
          ? t("menu.itemInUse")
          : (deleteMessages[result.failure.code] ?? t("menu.deleteFailed")),
      );
      return;
    }
    show(t("menu.itemDeleted", { name: itemName(item) }));
    router.refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("menu.title")}</h1>
          <p>{t("menu.subtitle")}</p>
        </div>
        {canEdit ? (
          <div className="page-head-actions">
            <button
              type="button"
              onClick={() => setCategoryDraft({ ...EMPTY_CATEGORY })}
            >
              {t("menu.newCategory")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!current}
              onClick={() => current && setItemDraft(emptyItem(current.id))}
            >
              {t("menu.newItem")}
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? null : <p className="notice">{t("menu.viewOnly")}</p>}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{categories.length}</span>
          <span className="stat-label">{t("menu.categories")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">{items.length}</span>
          <span className="stat-label">{t("menu.itemsTotal")}</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {items.filter((item) => item.isAvailable).length}
          </span>
          <span className="stat-label">{t("menu.available")}</span>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <p>{t("menu.empty")}</p>
            {canEdit ? (
              <button
                type="button"
                className="primary"
                onClick={() => setCategoryDraft({ ...EMPTY_CATEGORY })}
              >
                {t("menu.createCategory")}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="menu-layout">
          <section className="panel">
            <div className="panel-head">
              <span>{t("menu.categories")}</span>
              <span className="spacer" />
              <span>{categories.length}</span>
            </div>
            <ul className="category-list">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className={
                    category.id === current?.id
                      ? "category-item is-selected"
                      : "category-item"
                  }
                >
                  <button
                    type="button"
                    className="category-pick"
                    onClick={() => setSelected(category.id)}
                    aria-current={category.id === current?.id}
                  >
                    <span className="category-name">
                      {categoryName(category)}
                    </span>
                    <span className="category-meta">
                      {locale === "de" ? category.nameRu : category.nameDe} ·{" "}
                      {t("menu.itemsCount", {
                        count: countByCategory.get(category.id) ?? 0,
                      })}
                    </span>
                  </button>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        aria-label={t("menu.editCategory", {
                          name: categoryName(category),
                        })}
                        onClick={() =>
                          setCategoryDraft(toCategoryDraft(category))
                        }
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="ghost danger"
                        aria-label={t("menu.deleteCategory", {
                          name: categoryName(category),
                        })}
                        onClick={() => removeCategory(category)}
                      >
                        ×
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section>
            {visible.length === 0 ? (
              <div className="panel">
                <div className="empty-state">
                  <p>
                    {t("menu.categoryEmpty", {
                      name: current ? categoryName(current) : "",
                    })}
                  </p>
                  {canEdit && current ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setItemDraft(emptyItem(current.id))}
                    >
                      {t("menu.addItem")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t("menu.item")}</th>
                      <th>{t("menu.allergens")}</th>
                      <th className="num">{t("menu.price")}</th>
                      <th className="num">{t("menu.minutes")}</th>
                      <th>{t("menu.status")}</th>
                      {canEdit ? (
                        <th className="actions">{t("menu.actions")}</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr
                        key={item.id}
                        className={item.isAvailable ? "" : "is-off"}
                      >
                        <td data-label={t("menu.item")}>
                          <span className="row-title">{itemName(item)}</span>
                          <span className="row-sub">
                            {otherItemNames(item)}
                            {item.isVegan
                              ? ` · ${t("menu.vegan")}`
                              : item.isVegetarian
                                ? ` · ${t("menu.vegetarian")}`
                                : ""}
                          </span>
                        </td>
                        <td data-label={t("menu.allergens")}>
                          {item.allergens.length === 0 ? (
                            <span className="badge off">
                              {t("common.none")}
                            </span>
                          ) : (
                            <span className="chip-row">
                              {item.allergens.map((allergen) => (
                                <span className="chip static" key={allergen}>
                                  {t(`allergen.${allergen}`)}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td data-label={t("menu.price")} className="num">
                          <span className="item-card-price">
                            {formatEuros(item.priceCents, intlLocale(locale))}
                          </span>
                        </td>
                        <td data-label={t("menu.minutes")} className="num">
                          {item.prepMinutes}
                        </td>
                        <td data-label={t("menu.status")}>
                          {item.isAvailable ? (
                            <span className="badge on">{t("menu.onSale")}</span>
                          ) : (
                            <span className="badge off">
                              {t("menu.offSale")}
                            </span>
                          )}
                        </td>
                        {canEdit ? (
                          <td
                            data-label={t("menu.actions")}
                            className="actions"
                          >
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setItemDraft(toItemDraft(item))}
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              className="ghost danger"
                              onClick={() => removeItem(item)}
                            >
                              {t("common.delete")}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {categoryDraft ? (
        <CategoryForm
          draft={categoryDraft}
          onClose={() => setCategoryDraft(undefined)}
          onSaved={saved}
        />
      ) : null}

      {itemDraft ? (
        <ItemForm
          draft={itemDraft}
          categories={categories}
          onClose={() => setItemDraft(undefined)}
          onSaved={saved}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </>
  );
}
