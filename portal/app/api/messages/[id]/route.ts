import { type NextRequest, NextResponse } from "next/server";
import {
  dbFailure,
  NOT_FOUND,
  readId,
  requireRole,
  writeContext,
} from "@/lib/api";
import { deleteCallbackMessage } from "@/lib/messages";

export const runtime = "nodejs";

const MESSAGE_ROLES = ["admin", "operator"] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireRole(request, MESSAGE_ROLES);
  if (denied) {
    return denied;
  }

  const id = readId((await params).id);
  if (!id) {
    return NOT_FOUND();
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const removed = await deleteCallbackMessage(sql, restaurantId, id);
    return removed ? new NextResponse(null, { status: 204 }) : NOT_FOUND();
  } catch (error) {
    return dbFailure(error);
  }
}
