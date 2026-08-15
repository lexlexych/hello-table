import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { required, testDatabaseUrl } from "./helpers/db.ts";
import {
  addTable,
  createRestaurant,
  dropRestaurant,
  futureAt,
  isoDate,
  openAllWeek,
} from "./helpers/fixtures.ts";

const sql = postgres(testDatabaseUrl(), { max: 8 });

let restaurantId: string;
const created: string[] = [];

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "cancel");
  created.push(restaurantId);
  await openAllWeek(sql, restaurantId);
  await addTable(sql, restaurantId, "T1", 4);
  await addTable(sql, restaurantId, "T2", 4);
});

afterAll(async () => {
  for (const id of created) await dropRestaurant(sql, id);
  await sql.end();
});

function bookAt(id: string, at: Date, phone: string) {
  return sql`SELECT * FROM create_reservation_atomic(${id}::uuid, ${at}::timestamptz,
             2, 'Gast', ${phone}, 'de', 'test')`;
}

function cancel(id: string, phone: string, date: Date) {
  return sql<{ cancel_reservation_by_phone: number }[]>`
    SELECT cancel_reservation_by_phone(${id}::uuid, ${phone}::text, ${isoDate(date)}::date)`;
}

describe("cancel_reservation_by_phone", () => {
  it("находит бронь, записанную в другом формате номера", async () => {
    const at = futureAt(20, 12);
    await bookAt(restaurantId, at, "0049 30 111 22");
    // звонящий диктует тот же номер в формате E.164
    const [row] = await cancel(restaurantId, "+493011122", at);
    expect(row?.cancel_reservation_by_phone).toBe(1);

    const [saved] = await sql<{ status: string }[]>`
      SELECT status FROM reservations WHERE restaurant_id = ${restaurantId}
      AND starts_at = ${at}`;
    expect(saved?.status).toBe("cancelled");
  });

  it("повторный вызов возвращает ноль", async () => {
    const at = futureAt(21, 12);
    await bookAt(restaurantId, at, "+493011133");
    expect(
      (await cancel(restaurantId, "+493011133", at))[0]
        ?.cancel_reservation_by_phone,
    ).toBe(1);
    expect(
      (await cancel(restaurantId, "+493011133", at))[0]
        ?.cancel_reservation_by_phone,
    ).toBe(0);
  });

  it("не трогает брони на другую дату", async () => {
    const keep = futureAt(22, 12);
    const drop = futureAt(23, 12);
    await bookAt(restaurantId, keep, "+493011144");
    await bookAt(restaurantId, drop, "+493011144");

    const [row] = await cancel(restaurantId, "+493011144", drop);
    expect(row?.cancel_reservation_by_phone).toBe(1);

    const [survivor] = await sql<{ status: string }[]>`
      SELECT status FROM reservations WHERE restaurant_id = ${restaurantId}
      AND starts_at = ${keep}`;
    expect(survivor?.status).toBe("confirmed");
  });

  it("не трогает брони чужого ресторана", async () => {
    const other = await createRestaurant(sql, "cancel2");
    created.push(other);
    await openAllWeek(sql, other);
    await addTable(sql, other, "T", 4);
    const at = futureAt(24, 12);
    await bookAt(other, at, "+493011155");

    const [row] = await cancel(restaurantId, "+493011155", at);
    expect(row?.cancel_reservation_by_phone).toBe(0);

    const [survivor] = await sql<{ status: string }[]>`
      SELECT status FROM reservations WHERE restaurant_id = ${other}`;
    expect(survivor?.status).toBe("confirmed");
  });

  it("отдаёт phone_required на номере без цифр", async () => {
    await expect(
      cancel(restaurantId, "не помню", futureAt(25, 12)),
    ).rejects.toMatchObject({ code: "45012" });
  });
});

describe("create_callback_request", () => {
  it("создаёт запрос и заполняет delete_after от даты создания", async () => {
    const [row] = await sql<{ create_callback_request: string }[]>`
      SELECT create_callback_request(${restaurantId}::uuid, '+493011166', 'ru',
             'Клиент хочет банкет на 25 человек', 'banquet')`;
    const id = required(row?.create_callback_request, "callback id");

    const [saved] = await sql<{ delete_after: string; status: string }[]>`
      SELECT delete_after::text AS delete_after, status FROM callback_requests WHERE id = ${id}`;
    expect(saved?.status).toBe("new");

    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() + 14);
    expect(saved?.delete_after).toBe(expected.toISOString().slice(0, 10));
  });

  it("пересчитывает delete_after при обработке (§5.1)", async () => {
    const [row] = await sql<{ create_callback_request: string }[]>`
      SELECT create_callback_request(${restaurantId}::uuid, '+49301', 'de', 'Anfrage', 'other')`;
    const id = required(row?.create_callback_request, "callback id");

    const handled = new Date();
    handled.setUTCDate(handled.getUTCDate() + 3);
    await sql`UPDATE callback_requests SET status='done', handled_at=${handled},
              handled_by='operator' WHERE id = ${id}`;

    const [saved] = await sql<{ delete_after: string }[]>`
      SELECT delete_after::text AS delete_after FROM callback_requests WHERE id = ${id}`;
    const expected = new Date(handled);
    expected.setUTCDate(expected.getUTCDate() + 14);
    expect(saved?.delete_after).toBe(expected.toISOString().slice(0, 10));
  });

  it("отвергает резюме длиннее 400 символов (§6.2)", async () => {
    await expect(
      sql`SELECT create_callback_request(${restaurantId}::uuid, '+49', 'de',
          ${"x".repeat(401)}, 'other')`,
    ).rejects.toMatchObject({ code: "45014" });
  });

  it("отвергает неизвестную категорию", async () => {
    await expect(
      sql`SELECT create_callback_request(${restaurantId}::uuid, '+49', 'de', 'Anfrage', 'nonsense')`,
    ).rejects.toMatchObject({ code: "45013" });
  });
});

describe("purge_expired_personal_data (PROJECT.md §13)", () => {
  it("удаляет только просроченное и возвращает верный счёт", async () => {
    const purgeRestaurant = await createRestaurant(sql, "purge");
    created.push(purgeRestaurant);
    await openAllWeek(sql, purgeRestaurant);
    const tableId = await addTable(sql, purgeRestaurant, "T", 4);

    // Просроченная бронь: delete_after ставит триггер, поэтому переписываем явно.
    const past = futureAt(-40, 12);
    const [expired] = await sql<{ id: string }[]>`
      INSERT INTO reservations (restaurant_id, table_id, guest_name, party_size,
        starts_at, ends_at, source, language)
      VALUES (${purgeRestaurant}, ${tableId}, 'Alt', 2, ${past},
              ${new Date(past.getTime() + 90 * 60_000)}, 'phone', 'de')
      RETURNING id`;

    // Свежая бронь остаётся.
    const future = futureAt(30, 12);
    const [kept] = await sql<{ id: string }[]>`
      INSERT INTO reservations (restaurant_id, table_id, guest_name, party_size,
        starts_at, ends_at, source, language)
      VALUES (${purgeRestaurant}, ${tableId}, 'Neu', 2, ${future},
              ${new Date(future.getTime() + 90 * 60_000)}, 'phone', 'de')
      RETURNING id`;

    // Просроченный обратный звонок.
    const [callback] = await sql<{ id: string }[]>`
      INSERT INTO callback_requests (restaurant_id, caller_phone, language, summary, category,
        status, handled_at)
      VALUES (${purgeRestaurant}, '+49', 'de', 'alt', 'other', 'done',
              ${futureAt(-30, 12)})
      RETURNING id`;

    const expiredId = required(expired?.id, "expired reservation");
    const keptId = required(kept?.id, "kept reservation");
    const callbackId = required(callback?.id, "expired callback");

    // call_logs ссылается на бронь: после удаления ссылка обязана обнулиться, а не упасть.
    await sql`INSERT INTO call_logs (restaurant_id, room_name, reservation_id)
              VALUES (${purgeRestaurant}, 'room-1', ${expiredId})`;

    const [before] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations WHERE id = ${expiredId}`;
    expect(before?.n).toBe(1);

    const [result] = await sql<{ purge_expired_personal_data: number }[]>`
      SELECT purge_expired_personal_data()`;
    expect(result?.purge_expired_personal_data).toBeGreaterThanOrEqual(2);

    const [goneReservation] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations WHERE id = ${expiredId}`;
    const [goneCallback] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM callback_requests WHERE id = ${callbackId}`;
    const [survivor] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reservations WHERE id = ${keptId}`;
    expect(goneReservation?.n).toBe(0);
    expect(goneCallback?.n).toBe(0);
    expect(survivor?.n).toBe(1);

    // Запись о звонке пережила удаление персональных данных.
    const [log] = await sql<{ reservation_id: string | null }[]>`
      SELECT reservation_id FROM call_logs WHERE restaurant_id = ${purgeRestaurant}`;
    expect(log?.reservation_id).toBeNull();
  });
});
