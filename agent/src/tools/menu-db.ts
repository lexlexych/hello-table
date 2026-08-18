import {
  type CurrentMenuRow,
  currentMenuRowSchema,
  type Language,
  type MenuCategory,
  type SearchMenuRequest,
  type SearchMenuResponse,
  searchMenuResponseSchema,
} from "@hello-table/contracts";
import { log } from "@livekit/agents";
import { formatPrice } from "../formatting.ts";
import type { AgentDatabase, DatabaseOutcome } from "./database.ts";
import { toToolError } from "./database.ts";

type MenuInput = Omit<SearchMenuRequest, "session_id"> & { language: Language };
type MenuSuccess = Extract<SearchMenuResponse, { ok: true }>;

function groupMenu(
  rows: readonly CurrentMenuRow[],
  language: Language,
): MenuCategory[] {
  const categories = new Map<string, MenuCategory>();
  for (const row of rows) {
    let category = categories.get(row.category_id);
    if (category === undefined) {
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

/** Вызывает get_current_menu и валидирует полный актуальный каталог до LLM. */
export async function getCurrentMenu(
  sql: AgentDatabase,
  input: MenuInput,
): Promise<DatabaseOutcome<MenuSuccess>> {
  const logger = log().child({ rpc: "get_current_menu" });
  const startedAt = Date.now();
  try {
    const rows = await sql<CurrentMenuRow[]>`
      SELECT category_id, category_name, category_sort_order,
             item_id, item_name, item_description, item_price_cents,
             item_allergens, item_is_vegetarian, item_is_vegan,
             item_weight_g, item_volume_ml, item_kcal,
             item_protein_g, item_fat_g, item_carbs_g
      FROM get_current_menu(
        ${input.restaurant_id}::uuid,
        ${input.language}::char(2)
      )
    `;
    const parsedRows = currentMenuRowSchema.array().safeParse(rows);
    const response = parsedRows.success
      ? searchMenuResponseSchema.safeParse({
          ok: true,
          categories: groupMenu(parsedRows.data, input.language),
        })
      : { success: false as const };
    if (!response.success || !response.data.ok) {
      logger.warn({ result: "invalid_response" }, "database rpc");
      return { ok: false, error: "invalid_response" };
    }
    logger.info({ result: "ok", ms: Date.now() - startedAt }, "database rpc");
    return { ok: true, value: response.data };
  } catch (error) {
    const result = toToolError(error);
    logger.warn({ result, ms: Date.now() - startedAt }, "database rpc");
    return { ok: false, error: result };
  }
}
