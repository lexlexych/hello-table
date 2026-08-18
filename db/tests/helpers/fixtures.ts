import type { Sql } from "postgres";

/**
 * Фикстуры для тестов функций. Каждый тестовый файл создаёт СВОЙ ресторан
 * с уникальным slug и не зависит ни от seed, ни от других файлов.
 */

export interface RestaurantOptions {
  timezone?: string;
  slotMinutes?: number;
  bufferMinutes?: number;
  bookingStepMinutes?: number;
  maxPartySize?: number;
  pickupLeadMinutes?: number;
  pickupSlotCapacity?: number;
  isActive?: boolean;
}

let counter = 0;

/** Уникальный slug: тесты гоняются в одной базе, пересекаться им нельзя. */
export function uniqueSlug(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`.slice(0, 40);
}

export async function createRestaurant(
  sql: Sql,
  prefix: string,
  options: RestaurantOptions = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO restaurants (
      name, slug, timezone, slot_minutes, buffer_minutes, booking_step_minutes,
      max_party_size, pickup_lead_minutes, pickup_slot_capacity, is_active,
      ai_disclosure_de, ai_disclosure_ru, ai_disclosure_en
    ) VALUES (
      'Test', ${uniqueSlug(prefix)}, ${options.timezone ?? "UTC"},
      ${options.slotMinutes ?? 90}, ${options.bufferMinutes ?? 15},
      ${options.bookingStepMinutes ?? 15}, ${options.maxPartySize ?? 8},
      ${options.pickupLeadMinutes ?? 30}, ${options.pickupSlotCapacity ?? 4},
      ${options.isActive ?? true}, 'KI-Hinweis', 'Уведомление об ИИ', 'AI notice'
    ) RETURNING id`;
  if (!row) throw new Error("restaurant fixture was not created");
  return row.id;
}

/** Часы работы на все семь дней. По умолчанию 08:00–23:00 местного времени. */
export async function openAllWeek(
  sql: Sql,
  restaurantId: string,
  opens = "08:00",
  closes = "23:00",
): Promise<void> {
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await sql`INSERT INTO opening_hours (restaurant_id, weekday, opens, closes)
              VALUES (${restaurantId}, ${weekday}, ${opens}, ${closes})`;
  }
}

export async function addTable(
  sql: Sql,
  restaurantId: string,
  label: string,
  seats: number,
  zone: string | null = null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO restaurant_tables (restaurant_id, label, seats, zone)
    VALUES (${restaurantId}, ${label}, ${seats}, ${zone}) RETURNING id`;
  if (!row) throw new Error("table fixture was not created");
  return row.id;
}

export async function addCategory(
  sql: Sql,
  restaurantId: string,
  nameDe: string,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO menu_categories (restaurant_id, name_de, name_ru, name_en)
    VALUES (${restaurantId}, ${nameDe}, ${nameDe}, ${nameDe}) RETURNING id`;
  if (!row) throw new Error("category fixture was not created");
  return row.id;
}

export interface MenuItemOptions {
  nameDe: string;
  nameRu: string;
  nameEn: string;
  priceCents?: number;
  prepMinutes?: number;
  aliases?: string[];
  allergens?: string[];
  isVegetarian?: boolean;
  isVegan?: boolean;
  isAvailable?: boolean;
  descriptionDe?: string;
  descriptionRu?: string;
}

export async function addMenuItem(
  sql: Sql,
  categoryId: string,
  item: MenuItemOptions,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO menu_items (
      category_id, name_de, name_ru, name_en, description_de, description_ru,
      price_cents, prep_minutes, aliases, allergens,
      is_vegetarian, is_vegan, is_available
    ) VALUES (
      ${categoryId}, ${item.nameDe}, ${item.nameRu}, ${item.nameEn},
      ${item.descriptionDe ?? null}, ${item.descriptionRu ?? null},
      ${item.priceCents ?? 950}, ${item.prepMinutes ?? 15},
      ${item.aliases ?? []}, ${item.allergens ?? []},
      ${item.isVegetarian ?? false}, ${item.isVegan ?? false},
      ${item.isAvailable ?? true}
    ) RETURNING id`;
  if (!row) throw new Error("menu item fixture was not created");
  return row.id;
}

/**
 * Полная уборка ресторана. Порядок важен: menu_items ссылается на
 * menu_categories через ON DELETE RESTRICT, поэтому каскад от restaurants
 * сам по себе не проходит.
 */
export async function dropRestaurant(
  sql: Sql,
  restaurantId: string,
): Promise<void> {
  await sql`DELETE FROM pickup_order_items i USING pickup_orders o
            WHERE i.order_id = o.id AND o.restaurant_id = ${restaurantId}`;
  await sql`DELETE FROM pickup_orders WHERE restaurant_id = ${restaurantId}`;
  await sql`DELETE FROM menu_items WHERE category_id IN
            (SELECT id FROM menu_categories WHERE restaurant_id = ${restaurantId})`;
  await sql`DELETE FROM menu_categories WHERE restaurant_id = ${restaurantId}`;
  await sql`DELETE FROM restaurants WHERE id = ${restaurantId}`;
}

/** Ближайшая будущая дата (UTC) со сдвигом в днях и заданным часом. */
export function futureAt(daysAhead: number, utcHour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(utcHour, 0, 0, 0);
  return date;
}

/** Дата в формате YYYY-MM-DD для параметров типа date. */
export function isoDate(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return iso;
}
