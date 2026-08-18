import { TablesManager } from "@/components/tables-manager";
import { nearestDays, normalizeDay, todayInZone } from "@/lib/day";
import { db } from "@/lib/db";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurant } from "@/lib/restaurant";
import { listTablesForDay } from "@/lib/tables";

/** Список читается из базы на каждый заход: справочник маленький, кэшировать нечего. */
export const dynamic = "force-dynamic";

/** Сегодня и ещё пять дней подряд — остальное выбирается календарём. */
const QUICK_DAYS = 6;

export default async function TablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Смотрят обе роли; справочник редактирует только администратор, а брони ведут
  // обе (PROJECT.md §7.2). Маршруты записи проверяют роль сами — скрытая кнопка
  // защитой не является.
  const session = await requireSessionForPage(["admin", "operator"]);

  const sql = db();
  const restaurant = await getRestaurant(sql);
  // «Сегодня» — по времени ресторана, а не сервера: в 23:30 в Берлине сервер в UTC
  // показал бы уже завтрашний день.
  const today = todayInZone(restaurant.timezone);
  const raw = (await searchParams).date;
  const date = normalizeDay(typeof raw === "string" ? raw : undefined, today);

  const tables = await listTablesForDay(sql, restaurant.id, date);

  return (
    <TablesManager
      tables={tables}
      date={date}
      today={today}
      quickDays={nearestDays(today, QUICK_DAYS)}
      canEdit={session.role === "admin"}
    />
  );
}
