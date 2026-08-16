import { type NextRequest, NextResponse } from "next/server";
import { issueTestCallToken } from "@/lib/livekit";
import { guardRequest } from "@/lib/rbac";

export const runtime = "nodejs";

/**
 * Тестовый звонок доступен обеим ролям (PROJECT.md §7.2). Проверка здесь независима от
 * того, что отрисовала страница: скрытая кнопка защитой не является.
 */
export async function POST(request: NextRequest) {
  const guard = await guardRequest(request, ["admin", "operator"]);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? "unauthorized" : "forbidden" },
      { status: guard.status },
    );
  }

  const grant = await issueTestCallToken(guard.session);
  return NextResponse.json(grant);
}
