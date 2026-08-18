import { type NextRequest, NextResponse } from "next/server";
import { dbFailure, parseBody, requireAdmin, writeContext } from "@/lib/api";
import { createCategory } from "@/lib/menu";
import { categoryInputSchema } from "@/lib/schemas/menu";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) {
    return denied;
  }

  const parsed = await parseBody(request, categoryInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const category = await createCategory(sql, restaurantId, parsed.value);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return dbFailure(error);
  }
}
