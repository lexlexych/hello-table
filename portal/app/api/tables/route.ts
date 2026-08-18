import { type NextRequest, NextResponse } from "next/server";
import { dbFailure, parseBody, requireAdmin, writeContext } from "@/lib/api";
import { tableInputSchema } from "@/lib/schemas/tables";
import { createTable } from "@/lib/tables";

/** `postgres.js` — нативный TCP-клиент, ему нужен рантайм Node. */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseBody(request, tableInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const table = await createTable(sql, restaurantId, parsed.value);
    return NextResponse.json(table, { status: 201 });
  } catch (error) {
    return dbFailure(error);
  }
}
