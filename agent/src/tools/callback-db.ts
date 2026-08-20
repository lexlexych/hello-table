import {
  type RequestCallbackRequest,
  type RequestCallbackResponse,
  requestCallbackResponseSchema,
} from "@hello-table/contracts";
import { log } from "@livekit/agents";
import type { AgentDatabase, DatabaseOutcome } from "./database.ts";
import { toToolError } from "./database.ts";

type CallbackInput = Omit<RequestCallbackRequest, "session_id">;
type CallbackSuccess = Extract<RequestCallbackResponse, { ok: true }>;

interface CallbackRow {
  callback_id: string;
}

/** Сохраняет голосовой запрос через разрешённую agent_app SECURITY DEFINER RPC. */
export async function createCallbackRequest(
  sql: AgentDatabase,
  input: CallbackInput,
): Promise<DatabaseOutcome<CallbackSuccess>> {
  const logger = log().child({ rpc: "create_callback_request" });
  const startedAt = Date.now();
  try {
    const rows = await sql<CallbackRow[]>`
      SELECT create_callback_request(
        ${input.restaurant_id}::uuid,
        ${input.phone}::text,
        ${input.language}::char(2),
        ${input.summary}::text,
        ${input.category}::text
      ) AS callback_id
    `;
    const response = requestCallbackResponseSchema.safeParse(
      rows[0] ? { ok: true, callback_id: rows[0].callback_id } : undefined,
    );
    if (!response.success || !response.data.ok) {
      logger.warn({ result: "invalid_response" }, "database rpc");
      return { ok: false, error: "invalid_response" };
    }
    // Телефон и резюме намеренно не входят в лог: оба поля содержат PII.
    logger.info({ result: "ok", ms: Date.now() - startedAt }, "database rpc");
    return { ok: true, value: response.data };
  } catch (error) {
    const result = toToolError(error);
    logger.warn({ result, ms: Date.now() - startedAt }, "database rpc");
    return { ok: false, error: result };
  }
}
