import { n8nCreateReservationRequestSchema } from "@hello-table/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { writeContext } from "@/lib/api";
import {
  isAuthorizedN8nRequest,
  n8nToolFailure,
  n8nUnauthorized,
  parseN8nBody,
} from "@/lib/n8n-api";
import { createN8nReservation } from "@/lib/n8n-tools";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedN8nRequest(request)) return n8nUnauthorized();
  const parsed = await parseN8nBody(request, n8nCreateReservationRequestSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const { sql, restaurantId } = await writeContext();
    return NextResponse.json(
      await createN8nReservation(sql, restaurantId, parsed.value),
    );
  } catch (error) {
    return n8nToolFailure(error);
  }
}
