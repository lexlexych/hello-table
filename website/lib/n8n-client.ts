import { createHmac, randomUUID } from "node:crypto";
import type { z } from "zod";
import { getWebsiteConfig } from "./config";
import {
  type AvailabilityRequest,
  availabilityResponseSchema,
  type ReservationRequest,
  reservationResponseSchema,
} from "./schemas";

async function postSigned<T>(path: string, payload: object, schema: z.ZodType<T>): Promise<T> {
  const config = getWebsiteConfig();
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", config.n8nWebhookSecret).update(body).digest("hex");
  const response = await fetch(`${config.n8nBaseUrl}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) throw new Error(`n8n responded with status ${response.status}`);
  return schema.parse(await response.json());
}

export function checkAvailability(input: AvailabilityRequest) {
  const config = getWebsiteConfig();
  return postSigned(
    "reservation.check",
    { ...input, restaurant_id: config.restaurantId, session_id: randomUUID() },
    availabilityResponseSchema,
  );
}

export function createReservation(input: ReservationRequest) {
  const config = getWebsiteConfig();
  const { privacy_accepted: _privacyAccepted, ...reservation } = input;
  return postSigned(
    "reservation.create",
    { ...reservation, restaurant_id: config.restaurantId, session_id: randomUUID() },
    reservationResponseSchema,
  );
}
