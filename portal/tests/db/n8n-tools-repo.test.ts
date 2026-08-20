import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createN8nReservation,
  findN8nAvailableTables,
  getN8nMenu,
} from "@/lib/n8n-tools";
import { testDatabaseUrl } from "../../../db/tests/helpers/db";
import {
  addCategory,
  addMenuItem,
  addTable,
  createRestaurant,
  dropRestaurant,
  futureAt,
  isoDate,
  openAllWeek,
} from "../../../db/tests/helpers/fixtures";

const sql = postgres(testDatabaseUrl(), { max: 2 });
let restaurantId: string;
let tableId: string;
let visitDate: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "n8n-api-repo", {
    timezone: "UTC",
  });
  await openAllWeek(sql, restaurantId);
  tableId = await addTable(sql, restaurantId, "API-1", 4, "Terrasse");
  const categoryId = await addCategory(sql, restaurantId, "Pizza");
  await addMenuItem(sql, categoryId, {
    nameDe: "Margherita",
    nameRu: "Маргарита",
    nameEn: "Margherita",
    descriptionDe: "Tomate und Käse",
    descriptionRu: "Томаты и сыр",
    priceCents: 950,
    allergens: ["gluten", "milk"],
    isVegetarian: true,
  });
  visitDate = isoDate(futureAt(7, 0));
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await sql.end();
});

describe("n8n API RPC-репозиторий", () => {
  it("возвращает локализованное и типизированное меню", async () => {
    const response = await getN8nMenu(sql, restaurantId, { language: "ru" });
    expect(response.ok).toBe(true);
    expect(response.categories[0]).toMatchObject({ name: "Pizza" });
    expect(response.categories[0]?.items[0]).toMatchObject({
      name: "Маргарита",
      price_cents: 950,
      allergens: ["gluten", "milk"],
    });
    expect(response.categories[0]?.items[0]?.price).toContain("9,50");
  });

  it("находит столик и атомарно создаёт выбранную бронь", async () => {
    const available = await findN8nAvailableTables(sql, restaurantId, {
      date: visitDate,
      time: "19:00",
      party_size: 4,
    });
    expect(available.tables).toContainEqual({
      table_id: tableId,
      label: "API-1",
      seats: 4,
      zone: "Terrasse",
    });

    const created = await createN8nReservation(sql, restaurantId, {
      table_id: tableId,
      date: visitDate,
      time: "19:00",
      party_size: 4,
      guest_name: "Testgast",
      language: "de",
    });
    expect(created).toMatchObject({
      ok: true,
      table_label: "API-1",
    });

    const after = await findN8nAvailableTables(sql, restaurantId, {
      date: visitDate,
      time: "19:00",
      party_size: 4,
    });
    expect(after.tables).toHaveLength(0);
  });
});
