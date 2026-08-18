import type postgres from "postgres";
import type { Allergen, CategoryInput, MenuItemInput } from "./schemas/menu";

/**
 * Доступ к `menu_categories` и `menu_items`. Как и в `tables.ts`, соединение и id
 * ресторана — параметры, а не глобальное состояние.
 *
 * У `menu_items` собственного `restaurant_id` нет: принадлежность ресторану идёт через
 * категорию. Поэтому каждый запрос по блюду проверяет её через подзапрос —
 * иначе чужой id блюда прошёл бы насквозь.
 */

export interface MenuCategory {
  id: string;
  nameDe: string;
  nameRu: string;
  nameEn: string;
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  nameDe: string;
  nameRu: string;
  nameEn: string;
  descriptionDe: string | null;
  descriptionRu: string | null;
  descriptionEn: string | null;
  priceCents: number;
  allergens: Allergen[];
  aliases: string[];
  isVegetarian: boolean;
  isVegan: boolean;
  isAvailable: boolean;
  prepMinutes: number;
}

export async function listCategories(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<MenuCategory[]> {
  return sql<MenuCategory[]>`
    SELECT id, name_de AS "nameDe", name_ru AS "nameRu", name_en AS "nameEn",
           sort_order AS "sortOrder"
    FROM menu_categories
    WHERE restaurant_id = ${restaurantId}
    ORDER BY sort_order, name_de`;
}

export async function listItems(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<MenuItem[]> {
  return sql<MenuItem[]>`
    SELECT i.id, i.category_id AS "categoryId",
           i.name_de AS "nameDe", i.name_ru AS "nameRu", i.name_en AS "nameEn",
           i.description_de AS "descriptionDe", i.description_ru AS "descriptionRu",
           i.description_en AS "descriptionEn",
           i.price_cents AS "priceCents", i.allergens, i.aliases,
           i.is_vegetarian AS "isVegetarian", i.is_vegan AS "isVegan",
           i.is_available AS "isAvailable", i.prep_minutes AS "prepMinutes"
    FROM menu_items i
    JOIN menu_categories c ON c.id = i.category_id
    WHERE c.restaurant_id = ${restaurantId}
    ORDER BY c.sort_order, c.name_de, i.name_de`;
}

export async function createCategory(
  sql: postgres.Sql,
  restaurantId: string,
  input: CategoryInput,
): Promise<MenuCategory> {
  const [row] = await sql<MenuCategory[]>`
    INSERT INTO menu_categories (restaurant_id, name_de, name_ru, name_en, sort_order)
    VALUES (${restaurantId}, ${input.nameDe}, ${input.nameRu}, ${input.nameEn},
            ${input.sortOrder})
    RETURNING id, name_de AS "nameDe", name_ru AS "nameRu", name_en AS "nameEn",
              sort_order AS "sortOrder"`;
  if (!row) {
    throw new Error("INSERT в menu_categories не вернул строку");
  }
  return row;
}

export async function updateCategory(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
  input: CategoryInput,
): Promise<MenuCategory | undefined> {
  const [row] = await sql<MenuCategory[]>`
    UPDATE menu_categories
    SET name_de = ${input.nameDe}, name_ru = ${input.nameRu},
        name_en = ${input.nameEn}, sort_order = ${input.sortOrder}
    WHERE id = ${id} AND restaurant_id = ${restaurantId}
    RETURNING id, name_de AS "nameDe", name_ru AS "nameRu", name_en AS "nameEn",
              sort_order AS "sortOrder"`;
  return row;
}

/** Непустую категорию база не отдаст удалить: menu_items.category_id — ON DELETE RESTRICT. */
export async function deleteCategory(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM menu_categories
    WHERE id = ${id} AND restaurant_id = ${restaurantId}
    RETURNING id`;
  return rows.length > 0;
}

export async function createItem(
  sql: postgres.Sql,
  restaurantId: string,
  input: MenuItemInput,
): Promise<MenuItem | undefined> {
  // Подзапрос вместо доверия к categoryId из тела запроса: чужая категория
  // не даст ни одной строки, и INSERT просто ничего не вставит.
  const [row] = await sql<MenuItem[]>`
    INSERT INTO menu_items (
      category_id, name_de, name_ru, name_en,
      description_de, description_ru, description_en,
      price_cents, allergens, aliases,
      is_vegetarian, is_vegan, is_available, prep_minutes)
    SELECT c.id, ${input.nameDe}, ${input.nameRu}, ${input.nameEn},
           ${input.descriptionDe}, ${input.descriptionRu}, ${input.descriptionEn},
           ${input.priceCents}, ${input.allergens}, ${input.aliases},
           ${input.isVegetarian}, ${input.isVegan}, ${input.isAvailable},
           ${input.prepMinutes}
    FROM menu_categories c
    WHERE c.id = ${input.categoryId} AND c.restaurant_id = ${restaurantId}
    RETURNING id, category_id AS "categoryId",
              name_de AS "nameDe", name_ru AS "nameRu", name_en AS "nameEn",
              description_de AS "descriptionDe", description_ru AS "descriptionRu",
              description_en AS "descriptionEn",
              price_cents AS "priceCents", allergens, aliases,
              is_vegetarian AS "isVegetarian", is_vegan AS "isVegan",
              is_available AS "isAvailable", prep_minutes AS "prepMinutes"`;
  return row;
}

export async function updateItem(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
  input: MenuItemInput,
): Promise<MenuItem | undefined> {
  // Две проверки принадлежности: текущая категория блюда и та, в которую его переносят.
  const [row] = await sql<MenuItem[]>`
    UPDATE menu_items i
    SET category_id = ${input.categoryId},
        name_de = ${input.nameDe}, name_ru = ${input.nameRu}, name_en = ${input.nameEn},
        description_de = ${input.descriptionDe}, description_ru = ${input.descriptionRu},
        description_en = ${input.descriptionEn},
        price_cents = ${input.priceCents}, allergens = ${input.allergens},
        aliases = ${input.aliases}, is_vegetarian = ${input.isVegetarian},
        is_vegan = ${input.isVegan}, is_available = ${input.isAvailable},
        prep_minutes = ${input.prepMinutes}
    WHERE i.id = ${id}
      AND EXISTS (SELECT 1 FROM menu_categories c
                  WHERE c.id = i.category_id AND c.restaurant_id = ${restaurantId})
      AND EXISTS (SELECT 1 FROM menu_categories c
                  WHERE c.id = ${input.categoryId} AND c.restaurant_id = ${restaurantId})
    RETURNING i.id, i.category_id AS "categoryId",
              i.name_de AS "nameDe", i.name_ru AS "nameRu", i.name_en AS "nameEn",
              i.description_de AS "descriptionDe", i.description_ru AS "descriptionRu",
              i.description_en AS "descriptionEn",
              i.price_cents AS "priceCents", i.allergens, i.aliases,
              i.is_vegetarian AS "isVegetarian", i.is_vegan AS "isVegan",
              i.is_available AS "isAvailable", i.prep_minutes AS "prepMinutes"`;
  return row;
}

/** Блюдо, попавшее в заказ, база удалить не даст: pickup_order_items — ON DELETE RESTRICT. */
export async function deleteItem(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM menu_items i
    WHERE i.id = ${id}
      AND EXISTS (SELECT 1 FROM menu_categories c
                  WHERE c.id = i.category_id AND c.restaurant_id = ${restaurantId})
    RETURNING i.id`;
  return rows.length > 0;
}
