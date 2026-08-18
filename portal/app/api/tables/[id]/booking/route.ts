import { type NextRequest, NextResponse } from "next/server";
import {
  appFailure,
  NOT_FOUND,
  parseBody,
  readId,
  requireRole,
  writeContext,
} from "@/lib/api";
import { isValidDay } from "@/lib/day";
import { tableBookingSchema } from "@/lib/schemas/tables";
import { bookTableForDay, cancelTableBooking } from "@/lib/tables";

export const runtime = "nodejs";

/**
 * Дневная бронь конкретного столика. В отличие от справочника столиков её ведут обе
 * роли: по PROJECT.md §7.2 брони создаёт и отменяет в том числе оператор.
 *
 * Дальше маршрут ничего не решает — все правила (прошедший день, занятость, чужой
 * ресторан) проверяет `book_table_for_day`, и сюда они приходят кодами 45xxx.
 */

const BOOKING_ROLES = ["admin", "operator"] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireRole(request, BOOKING_ROLES);
  if (denied) {
    return denied;
  }

  const id = readId((await params).id);
  if (!id) {
    return NOT_FOUND();
  }

  const parsed = await parseBody(request, tableBookingSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const booking = await bookTableForDay(sql, restaurantId, id, parsed.value);
    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    return appFailure(error);
  }
}

/**
 * Снятие брони. День приходит параметром адреса, а не телом: у DELETE тело неудобно,
 * а идентификатор брони клиенту знать незачем — на столик в дне бронь ровно одна.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireRole(request, BOOKING_ROLES);
  if (denied) {
    return denied;
  }

  const id = readId((await params).id);
  const date = request.nextUrl.searchParams.get("date");
  if (!id || !date || !isValidDay(date)) {
    return NOT_FOUND();
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const cancelled = await cancelTableBooking(sql, restaurantId, id, date);
    return cancelled ? new NextResponse(null, { status: 204 }) : NOT_FOUND();
  } catch (error) {
    return appFailure(error);
  }
}
