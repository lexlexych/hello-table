import postgres, { type Sql } from "postgres";
import { getWebsiteConfig } from "./config";
import {
  type AvailabilityRequest,
  type AvailabilityResponse,
  availabilityResponseSchema,
  type ReservationRequest,
  type ReservationResponse,
  reservationResponseSchema,
} from "./schemas";

type WebsiteDatabase = Sql;

type WebsiteGlobal = typeof globalThis & {
  websiteDatabase?: WebsiteDatabase;
};

interface ReservationRow {
  reservation_id: string;
  table_label: string;
  starts_at: Date | string;
  ends_at: Date | string;
}

const reservationErrors = {
  "45000": "restaurant_not_found",
  "45004": "closed_at_requested_time",
  "45005": "party_too_large",
  "45006": "slot_in_past",
  "45015": "table_not_available",
  "45016": "table_already_booked",
} as const;

function timestampText(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export function getWebsiteDatabase(): WebsiteDatabase {
  const websiteGlobal = globalThis as WebsiteGlobal;
  if (!websiteGlobal.websiteDatabase) {
    const { databaseUrl } = getWebsiteConfig();
    websiteGlobal.websiteDatabase = postgres(databaseUrl, {
      max: 4,
      idle_timeout: 30,
      connect_timeout: 5,
      connection: {
        application_name: "hello-table-website",
        statement_timeout: 5_000,
        lock_timeout: 5_000,
      },
    });
  }
  return websiteGlobal.websiteDatabase;
}

export async function findAvailableTables(
  sql: WebsiteDatabase,
  restaurantId: string,
  input: AvailabilityRequest,
): Promise<AvailabilityResponse> {
  try {
    const rows = await sql`
      SELECT table_id, table_label AS label, table_seats AS seats, table_zone AS zone
      FROM find_available_tables(
        ${restaurantId}::uuid,
        ${input.date}::date,
        ${input.time}::time,
        ${input.party_size}::int
      )
    `;
    return availabilityResponseSchema.parse({ ok: true, tables: rows });
  } catch (error) {
    if (databaseErrorCode(error) === "45000") {
      return { ok: false, error: "restaurant_not_found" };
    }
    throw error;
  }
}

export async function createWebsiteReservation(
  sql: WebsiteDatabase,
  restaurantId: string,
  input: ReservationRequest,
): Promise<ReservationResponse> {
  const { privacy_accepted: _privacyAccepted, ...reservation } = input;
  try {
    const rows = await sql<ReservationRow[]>`
      SELECT reservation_id,
             booked_table_label AS table_label,
             confirmed_starts_at AS starts_at,
             confirmed_ends_at AS ends_at
      FROM create_reservation_for_table(
        ${restaurantId}::uuid,
        ${reservation.table_id}::uuid,
        ${reservation.date}::date,
        ${reservation.time}::time,
        ${reservation.party_size}::int,
        ${reservation.guest_name}::text,
        ${reservation.guest_phone}::text,
        ${reservation.language}::char(2),
        'website'::text
      )
    `;
    const row = rows[0];
    return reservationResponseSchema.parse(
      row
        ? {
            ok: true,
            reservation_id: row.reservation_id,
            table_label: row.table_label,
            starts_at: timestampText(row.starts_at),
            ends_at: timestampText(row.ends_at),
          }
        : { ok: false, error: "invalid_request" },
    );
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code && code in reservationErrors) {
      return {
        ok: false,
        error: reservationErrors[code as keyof typeof reservationErrors],
      };
    }
    throw error;
  }
}
