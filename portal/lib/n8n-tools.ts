import {
  type AvailableTable,
  availableTableSchema,
  type CheckAvailabilityResponse,
  type CreateReservationResponse,
  type CurrentMenuRow,
  checkAvailabilityResponseSchema,
  createReservationResponseSchema,
  currentMenuRowSchema,
  type Language,
  type MenuCategory,
  type N8nCheckAvailabilityRequest,
  type N8nCreateReservationRequest,
  type N8nSearchMenuRequest,
  type SearchMenuResponse,
  searchMenuResponseSchema,
} from "@hello-table/contracts";
import type postgres from "postgres";

type AvailabilitySuccess = Extract<CheckAvailabilityResponse, { ok: true }>;
type ReservationSuccess = Extract<CreateReservationResponse, { ok: true }>;
type MenuSuccess = Extract<SearchMenuResponse, { ok: true }>;

interface ReservationRow {
  reservation_id: string;
  table_label: string;
  starts_at: Date | string;
  ends_at: Date | string;
}

const LOCALES: Record<Language, string> = {
  de: "de-DE",
  ru: "ru-RU",
  en: "en-GB",
};

function formatPrice(cents: number, language: Language): string {
  return new Intl.NumberFormat(LOCALES[language], {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function timestampText(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function groupMenu(
  rows: readonly CurrentMenuRow[],
  language: Language,
): MenuCategory[] {
  const categories = new Map<string, MenuCategory>();
  for (const row of rows) {
    let category = categories.get(row.category_id);
    if (!category) {
      category = { id: row.category_id, name: row.category_name, items: [] };
      categories.set(row.category_id, category);
    }
    category.items.push({
      id: row.item_id,
      name: row.item_name,
      description: row.item_description,
      price_cents: row.item_price_cents,
      price: formatPrice(row.item_price_cents, language),
      allergens: row.item_allergens,
      is_vegetarian: row.item_is_vegetarian,
      is_vegan: row.item_is_vegan,
      weight_g: row.item_weight_g,
      volume_ml: row.item_volume_ml,
      kcal: row.item_kcal,
      protein_g: row.item_protein_g,
      fat_g: row.item_fat_g,
      carbs_g: row.item_carbs_g,
    });
  }
  return [...categories.values()];
}

export async function getN8nMenu(
  sql: postgres.Sql,
  restaurantId: string,
  input: N8nSearchMenuRequest,
): Promise<MenuSuccess> {
  const rows = await sql<CurrentMenuRow[]>`
    SELECT category_id, category_name, category_sort_order,
           item_id, item_name, item_description, item_price_cents,
           item_allergens, item_is_vegetarian, item_is_vegan,
           item_weight_g, item_volume_ml, item_kcal,
           item_protein_g, item_fat_g, item_carbs_g
    FROM get_current_menu(
      ${restaurantId}::uuid,
      ${input.language}::char(2)
    )`;
  const parsedRows = currentMenuRowSchema.array().parse(rows);
  return searchMenuResponseSchema.parse({
    ok: true,
    categories: groupMenu(parsedRows, input.language),
  }) as MenuSuccess;
}

export async function findN8nAvailableTables(
  sql: postgres.Sql,
  restaurantId: string,
  input: N8nCheckAvailabilityRequest,
): Promise<AvailabilitySuccess> {
  const rows = await sql<AvailableTable[]>`
    SELECT table_id, table_label AS label, table_seats AS seats, table_zone AS zone
    FROM find_available_tables(
      ${restaurantId}::uuid,
      ${input.date}::date,
      ${input.time}::time,
      ${input.party_size}::int
    )`;
  const tables = availableTableSchema.array().parse(rows);
  return checkAvailabilityResponseSchema.parse({
    ok: true,
    tables,
  }) as AvailabilitySuccess;
}

export async function createN8nReservation(
  sql: postgres.Sql,
  restaurantId: string,
  input: N8nCreateReservationRequest,
): Promise<ReservationSuccess> {
  const rows = await sql<ReservationRow[]>`
    SELECT reservation_id,
           booked_table_label AS table_label,
           confirmed_starts_at AS starts_at,
           confirmed_ends_at AS ends_at
    FROM create_reservation_for_table(
      ${restaurantId}::uuid,
      ${input.table_id}::uuid,
      ${input.date}::date,
      ${input.time}::time,
      ${input.party_size}::int,
      ${input.guest_name}::text,
      NULL::text,
      ${input.language}::char(2),
      'phone'::text
    )`;
  const row = rows[0];
  return createReservationResponseSchema.parse(
    row
      ? {
          ok: true,
          reservation_id: row.reservation_id,
          table_label: row.table_label,
          starts_at: timestampText(row.starts_at),
          ends_at: timestampText(row.ends_at),
        }
      : undefined,
  ) as ReservationSuccess;
}
