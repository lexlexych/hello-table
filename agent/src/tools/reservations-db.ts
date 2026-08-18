import {
  type AvailableTable,
  availableTableSchema,
  type CheckAvailabilityRequest,
  type CheckAvailabilityResponse,
  type CreateReservationRequest,
  type CreateReservationResponse,
  checkAvailabilityResponseSchema,
  createReservationResponseSchema,
} from "@hello-table/contracts";
import { log } from "@livekit/agents";
import type { AgentDatabase, DatabaseOutcome } from "./database.ts";
import { toToolError } from "./database.ts";

type AvailabilityInput = Omit<CheckAvailabilityRequest, "session_id">;
type ReservationInput = Omit<CreateReservationRequest, "session_id">;

type AvailabilitySuccess = Extract<CheckAvailabilityResponse, { ok: true }>;
type ReservationSuccess = Extract<CreateReservationResponse, { ok: true }>;

interface ReservationRow {
  reservation_id: string;
  table_label: string;
  starts_at: Date | string;
  ends_at: Date | string;
}

function timestampText(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Вызывает find_available_tables; функция базы уже фильтрует занятость и вместимость. */
export async function findAvailableTables(
  sql: AgentDatabase,
  input: AvailabilityInput,
): Promise<DatabaseOutcome<AvailabilitySuccess>> {
  const logger = log().child({ rpc: "find_available_tables" });
  const startedAt = Date.now();
  try {
    const rows = await sql<AvailableTable[]>`
      SELECT table_id, table_label AS label, table_seats AS seats, table_zone AS zone
      FROM find_available_tables(
        ${input.restaurant_id}::uuid,
        ${input.date}::date,
        ${input.time}::time,
        ${input.party_size}::int
      )
    `;
    const tables = availableTableSchema.array().safeParse(rows);
    const response = tables.success
      ? checkAvailabilityResponseSchema.safeParse({
          ok: true,
          tables: tables.data,
        })
      : { success: false as const };
    if (!response.success || !response.data.ok) {
      logger.warn({ result: "invalid_response" }, "database rpc");
      return { ok: false, error: "invalid_response" };
    }
    logger.info({ result: "ok", ms: Date.now() - startedAt }, "database rpc");
    return { ok: true, value: response.data };
  } catch (error) {
    const result = toToolError(error);
    logger.warn({ result, ms: Date.now() - startedAt }, "database rpc");
    return { ok: false, error: result };
  }
}

/** Вызывает атомарную RPC бронирования выбранного столика. */
export async function createReservation(
  sql: AgentDatabase,
  input: ReservationInput,
): Promise<DatabaseOutcome<ReservationSuccess>> {
  const logger = log().child({ rpc: "create_reservation_for_table" });
  const startedAt = Date.now();
  try {
    const rows = await sql<ReservationRow[]>`
      SELECT reservation_id,
             booked_table_label AS table_label,
             confirmed_starts_at AS starts_at,
             confirmed_ends_at AS ends_at
      FROM create_reservation_for_table(
        ${input.restaurant_id}::uuid,
        ${input.table_id}::uuid,
        ${input.date}::date,
        ${input.time}::time,
        ${input.party_size}::int,
        ${input.guest_name}::text,
        ${input.guest_phone}::text,
        ${input.language}::char(2),
        'phone'::text
      )
    `;
    const row = rows[0];
    const response = createReservationResponseSchema.safeParse(
      row
        ? {
            ok: true,
            reservation_id: row.reservation_id,
            table_label: row.table_label,
            starts_at: timestampText(row.starts_at),
            ends_at: timestampText(row.ends_at),
          }
        : undefined,
    );
    if (!response.success || !response.data.ok) {
      logger.warn({ result: "invalid_response" }, "database rpc");
      return { ok: false, error: "invalid_response" };
    }
    logger.info({ result: "ok", ms: Date.now() - startedAt }, "database rpc");
    return { ok: true, value: response.data };
  } catch (error) {
    const result = toToolError(error);
    logger.warn({ result, ms: Date.now() - startedAt }, "database rpc");
    return { ok: false, error: result };
  }
}
