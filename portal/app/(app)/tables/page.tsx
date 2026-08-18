import { TablesManager } from "@/components/tables-manager";
import { db } from "@/lib/db";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";
import { listTables } from "@/lib/tables";

/** Список читается из базы на каждый заход: справочник маленький, кэшировать нечего. */
export const dynamic = "force-dynamic";

export default async function TablesPage() {
  // Смотрят обе роли, редактирует только администратор (PROJECT.md §7.2).
  // Маршруты записи проверяют роль сами — скрытая кнопка защитой не является.
  const session = await requireSessionForPage(["admin", "operator"]);

  const sql = db();
  const tables = await listTables(sql, await getRestaurantId(sql));

  return <TablesManager tables={tables} canEdit={session.role === "admin"} />;
}
