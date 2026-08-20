import { type NextRequest, NextResponse } from "next/server";
import {
  dbFailure,
  NOT_FOUND,
  parseBody,
  readId,
  writeContext,
} from "@/lib/api";
import { updateCallbackMessageStatus } from "@/lib/messages";
import { guardRequest } from "@/lib/rbac";
import { messageStatusInputSchema } from "@/lib/schemas/messages";

export const runtime = "nodejs";

const MESSAGE_ROLES = ["admin", "operator"] as const;

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const guard = await guardRequest(request, MESSAGE_ROLES);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? "unauthorized" : "forbidden" },
      { status: guard.status },
    );
  }

  const id = readId((await params).id);
  if (!id) {
    return NOT_FOUND();
  }
  const parsed = await parseBody(request, messageStatusInputSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const { sql, restaurantId } = await writeContext();
    const changed = await updateCallbackMessageStatus(
      sql,
      restaurantId,
      id,
      parsed.value.status,
      guard.session.username,
    );
    return changed ? NextResponse.json(changed) : NOT_FOUND();
  } catch (error) {
    return dbFailure(error);
  }
}
