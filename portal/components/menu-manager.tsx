"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
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
import type { MenuCategory, MenuItem } from "@/lib/menu";
import { ALLERGEN_LABELS, formatEuros } from "@/lib/schemas/menu";

/**
 * Экран меню: слева категории, справа блюда выбранной категории. Данные приходят
 * с сервера, после записи страница перечитывается через `router.refresh()`.
 */

/** `in_use` разбирается на месте: текст зависит от того, категория это или блюдо. */
const DELETE_MESSAGES: Record<string, string> = {
  not_found: "Уже удалено. Обновите страницу.",
  forbidden: "Удаление доступно только администратору.",
  unauthorized: "Сессия истекла. Войдите заново.",
  network: "Сервер недоступен. Проверьте соединение.",
};

export function MenuManager({
  categories,
  items,
  canEdit,
}: {
  categories: MenuCategory[];
  items: MenuItem[];
  canEdit: boolean;
}) {
  const router = useRouter();
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
      show(
        `В категории «${category.nameRu}» ещё ${count} блюд — сначала перенесите или удалите их.`,
      );
      return;
    }
    if (!window.confirm(`Удалить категорию «${category.nameRu}»?`)) {
      return;
    }

    const result = await apiSend(
      `/api/menu/categories/${category.id}`,
      "DELETE",
    );
    if (!result.ok) {
      show(
        result.failure.code === "in_use"
          ? "В категории есть блюда — удалить её нельзя."
          : (DELETE_MESSAGES[result.failure.code] ?? "Не удалось удалить."),
      );
      return;
    }
    show(`Категория «${category.nameRu}» удалена`);
    router.refresh();
  }

  async function removeItem(item: MenuItem) {
    if (
      !window.confirm(
        `Удалить блюдо «${item.nameRu}»? Если оно попадало в заказы, база не даст его удалить — тогда снимите блюдо с продажи.`,
      )
    ) {
      return;
    }

    const result = await apiSend(`/api/menu/items/${item.id}`, "DELETE");
    if (!result.ok) {
      show(
        result.failure.code === "in_use"
          ? "Блюдо есть в оформленных заказах — снимите его с продажи вместо удаления."
          : (DELETE_MESSAGES[result.failure.code] ?? "Не удалось удалить."),
      );
      return;
    }
    show(`Блюдо «${item.nameRu}» удалено`);
    router.refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Меню</h1>
          <p>
            Категории и блюда на трёх языках: по ним агент отвечает на вопросы и
            собирает заказ на самовывоз.
          </p>
        </div>
        {canEdit ? (
          <div className="page-head-actions">
            <button
              type="button"
              onClick={() => setCategoryDraft({ ...EMPTY_CATEGORY })}
            >
              Новая категория
            </button>
            <button
              type="button"
              className="primary"
              disabled={!current}
              onClick={() => current && setItemDraft(emptyItem(current.id))}
            >
              Новое блюдо
            </button>
          </div>
        ) : null}
      </div>

      {canEdit ? null : (
        <p className="notice">
          Режим просмотра: изменять меню может только администратор.
        </p>
      )}

      <div className="stat-row">
        <div className="stat">
          <span className="stat-value">{categories.length}</span>
          <span className="stat-label">категорий</span>
        </div>
        <div className="stat">
          <span className="stat-value">{items.length}</span>
          <span className="stat-label">блюд всего</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            {items.filter((item) => item.isAvailable).length}
          </span>
          <span className="stat-label">в продаже</span>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <p>
              Меню пустое. Начните с категории — блюда добавляются внутрь неё.
            </p>
            {canEdit ? (
              <button
                type="button"
                className="primary"
                onClick={() => setCategoryDraft({ ...EMPTY_CATEGORY })}
              >
                Создать категорию
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="menu-layout">
          <section className="panel">
            <div className="panel-head">
              <span>Категории</span>
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
                    <span className="category-name">{category.nameRu}</span>
                    <span className="category-meta">
                      {category.nameDe} ·{" "}
                      {countByCategory.get(category.id) ?? 0} блюд
                    </span>
                  </button>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        className="ghost"
                        aria-label={`Изменить категорию ${category.nameRu}`}
                        onClick={() =>
                          setCategoryDraft(toCategoryDraft(category))
                        }
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="ghost danger"
                        aria-label={`Удалить категорию ${category.nameRu}`}
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
                  <p>В категории «{current?.nameRu}» пока нет блюд.</p>
                  {canEdit && current ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setItemDraft(emptyItem(current.id))}
                    >
                      Добавить блюдо
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Блюдо</th>
                      <th>Аллергены</th>
                      <th className="num">Цена</th>
                      <th className="num">Мин</th>
                      <th>Статус</th>
                      {canEdit ? <th className="actions">Действия</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr
                        key={item.id}
                        className={item.isAvailable ? "" : "is-off"}
                      >
                        <td data-label="Блюдо">
                          <span className="row-title">{item.nameRu}</span>
                          <span className="row-sub">
                            {item.nameDe} / {item.nameEn}
                            {item.isVegan
                              ? " · веганское"
                              : item.isVegetarian
                                ? " · вегетарианское"
                                : ""}
                          </span>
                        </td>
                        <td data-label="Аллергены">
                          {item.allergens.length === 0 ? (
                            <span className="badge off">нет</span>
                          ) : (
                            <span className="chip-row">
                              {item.allergens.map((allergen) => (
                                <span className="chip static" key={allergen}>
                                  {ALLERGEN_LABELS[allergen]}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                        <td data-label="Цена" className="num">
                          <span className="item-card-price">
                            {formatEuros(item.priceCents)}
                          </span>
                        </td>
                        <td data-label="Готовится" className="num">
                          {item.prepMinutes}
                        </td>
                        <td data-label="Статус">
                          {item.isAvailable ? (
                            <span className="badge on">в продаже</span>
                          ) : (
                            <span className="badge off">снято</span>
                          )}
                        </td>
                        {canEdit ? (
                          <td data-label="Действия" className="actions">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setItemDraft(toItemDraft(item))}
                            >
                              Изменить
                            </button>
                            <button
                              type="button"
                              className="ghost danger"
                              onClick={() => removeItem(item)}
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
