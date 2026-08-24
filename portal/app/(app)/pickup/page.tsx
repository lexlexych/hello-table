import { PickupBoard } from "@/components/pickup-board";
import { db } from "@/lib/db";
import { getPortalLocale } from "@/lib/i18n/server";
import { listItems } from "@/lib/menu";
import { listOrdersForToday } from "@/lib/pickup";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";

/** Доска меняется в течение дня, кэшировать её нечего. */
export const dynamic = "force-dynamic";

export default async function PickupPage() {
  // Заказы ведут обе роли, и одинаково: оператор их и создаёт, и переводит (§7.2).
  await requireSessionForPage(["admin", "operator"]);
  const locale = await getPortalLocale();

  const sql = db();
  const restaurantId = await getRestaurantId(sql);
  const [orders, menu] = await Promise.all([
    listOrdersForToday(sql, restaurantId),
    listItems(sql, restaurantId),
  ]);

  // Форма предлагает только то, что кухня отдаёт сегодня; недоступное блюдо база
  // всё равно отвергнет кодом 45003.
  const available = menu
    .filter((item) => item.isAvailable)
    .map((item) => ({
      id: item.id,
      name:
        locale === "de"
          ? item.nameDe
          : locale === "en"
            ? item.nameEn
            : item.nameRu,
      priceCents: item.priceCents,
    }));

  return <PickupBoard orders={orders} menu={available} />;
}
