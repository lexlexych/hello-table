import { type NextRequest, NextResponse } from "next/server";
import {
  dbFailure,
  NOT_FOUND,
  parseBody,
  readId,
  requireAdmin,
  writeContext,
} from "@/lib/api";
import { tableInputSchema } from "@/lib/schemas/tables";
import { deleteTable, updateTable } from "@/lib/tables";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const id = readId((await params).id);
  if (!id) {
    return NOT_FOUND();
  }

  const parsed = await parseBody(request, tableInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const table = await updateTable(sql, restaurantId, id, parsed.value);
    return table ? NextResponse.json(table) : NOT_FOUND();
  } catch (error) {
    return dbFailure(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const id = readId((await params).id);
  if (!id) {
    return NOT_FOUND();
  }

  try {
    const { sql, restaurantId } = await writeContext();
    // Столик с бронями база не отдаст: ошибка 23503 станет 409 in_use.
    const removed = await deleteTable(sql, restaurantId, id);
    return removed ? new NextResponse(null, { status: 204 }) : NOT_FOUND();
  } catch (error) {
    return dbFailure(error);
  }
}
