import { MenuManager } from "@/components/menu-manager";
import { db } from "@/lib/db";
import { listCategories, listItems } from "@/lib/menu";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  // Меню читают обе роли: без него оператор не ответит гостю (PROJECT.md §7.2).
  const session = await requireSessionForPage(["admin", "operator"]);

  const sql = db();
  const restaurantId = await getRestaurantId(sql);
  const [categories, items] = await Promise.all([
    listCategories(sql, restaurantId),
    listItems(sql, restaurantId),
  ]);

  return (
    <MenuManager
      categories={categories}
      items={items}
      canEdit={session.role === "admin"}
    />
  );
}
