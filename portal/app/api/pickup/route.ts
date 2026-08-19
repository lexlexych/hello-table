import { type NextRequest, NextResponse } from "next/server";
import { appFailure, parseBody, requireRole, writeContext } from "@/lib/api";
import { createOrder } from "@/lib/pickup";
import { pickupOrderInputSchema } from "@/lib/schemas/pickup";

/** `postgres.js` — нативный TCP-клиент, ему нужен рантайм Node. */
export const runtime = "nodejs";

/**
 * Создание заказа на самовывоз оператором за стойкой или по телефону. Заказы ведут
 * обе роли (PROJECT.md §7.2), в отличие от справочников меню и столиков.
 *
 * Дальше маршрут ничего не решает: сумму, цены позиций, вместимость слота, время
 * готовности и номер заказа считает `create_pickup_order_atomic`, и её отказы
 * приходят сюда кодами 45xxx. Дату выдачи не спрашиваем — доска работает одним днём,
 * и сегодняшний день по часовому поясу ресторана подставляет сама база.
 */
const PICKUP_ROLES = ["admin", "operator"] as const;

export async function POST(request: NextRequest) {
  const denied = await requireRole(request, PICKUP_ROLES);
  if (denied) {
    return denied;
  }

  const parsed = await parseBody(request, pickupOrderInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const order = await createOrder(sql, restaurantId, parsed.value);
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return appFailure(error);
  }
}
