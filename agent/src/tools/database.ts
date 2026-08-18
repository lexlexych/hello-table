import type { ToolError } from "@hello-table/contracts";
import postgres, { type Sql } from "postgres";

export type AgentDatabase = Sql;

export type DatabaseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: ToolError };

const SQLSTATE_ERRORS = {
  "45000": "restaurant_not_found",
  "45001": "no_table_available",
  "45004": "closed_at_requested_time",
  "45005": "party_too_large",
  "45006": "slot_in_past",
  "45015": "table_not_available",
  "45016": "table_already_booked",
} as const satisfies Record<string, ToolError>;

/** Один небольшой пул на job-процесс; SQL statement и connect timeout задаются серверу. */
export function createAgentDatabase(
  url: string,
  timeoutMs: number,
): AgentDatabase {
  return postgres(url, {
    max: 4,
    idle_timeout: 30,
    connect_timeout: Math.ceil(timeoutMs / 1_000),
    connection: {
      application_name: "hello-table-agent",
      statement_timeout: timeoutMs,
      lock_timeout: timeoutMs,
    },
  });
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

/** Переводит только машинный код; текст SQL-ошибки может содержать входные данные. */
export function toToolError(error: unknown): ToolError {
  const code = errorCode(error);
  if (code && code in SQLSTATE_ERRORS) {
    return SQLSTATE_ERRORS[code as keyof typeof SQLSTATE_ERRORS];
  }
  if (code === "57014" || code === "CONNECT_TIMEOUT") {
    return "timeout";
  }
  return "unreachable";
}
