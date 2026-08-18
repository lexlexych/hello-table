import { type NextRequest, NextResponse } from "next/server";
import {
  dbFailure,
  NOT_FOUND,
  parseBody,
  requireAdmin,
  writeContext,
} from "@/lib/api";
import { createItem } from "@/lib/menu";
import { menuItemInputSchema } from "@/lib/schemas/menu";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseBody(request, menuItemInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    // Пусто — значит категории с таким id в этом ресторане нет.
    const item = await createItem(sql, restaurantId, parsed.value);
    return item ? NextResponse.json(item, { status: 201 }) : NOT_FOUND();
  } catch (error) {
    return dbFailure(error);
  }
}
