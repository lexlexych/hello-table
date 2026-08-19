import { type NextRequest, NextResponse } from "next/server";
import {
  appFailure,
  NOT_FOUND,
  parseBody,
  readId,
  requireRole,
  writeContext,
} from "@/lib/api";
import { updateOrderStatus } from "@/lib/pickup";
import { pickupStatusInputSchema } from "@/lib/schemas/pickup";

export const runtime = "nodejs";

/**
 * Перевод заказа между колонками канбан-доски. Направление перехода не ограничивается:
 * оператор возвращает карточку назад, если ошибся. Единственное, что база не позволит, —
 * вернуть заказ в активный статус, если его номер успел занять другой активный заказ
 * (частичный уникальный индекс `pickup_orders_active_number_uk`, 23505 → 409).
 */
const PICKUP_ROLES = ["admin", "operator"] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireRole(request, PICKUP_ROLES);
  if (denied) {
    return denied;
  }

  const id = readId((await params).id);
  if (!id) {
    return NOT_FOUND();
  }

  const parsed = await parseBody(request, pickupStatusInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const changed = await updateOrderStatus(
      sql,
      restaurantId,
      id,
      parsed.value.status,
    );
    return changed ? NextResponse.json(changed) : NOT_FOUND();
  } catch (error) {
    return appFailure(error);
  }
}
