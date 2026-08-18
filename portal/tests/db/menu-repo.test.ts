import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  listCategories,
  listItems,
  updateCategory,
  updateItem,
} from "@/lib/menu";
// Без расширения `.ts`: файл проверяется конфигурацией портала
// (`moduleResolution: bundler`), где явное расширение запрещено.
import { testDatabaseUrl } from "../../../db/tests/helpers/db";
import {
  createRestaurant,
  dropRestaurant,
} from "../../../db/tests/helpers/fixtures";

/**
 * Репозиторий меню против настоящего Postgres: изоляция по ресторану идёт через
 * категорию, и проверить это можно только на реальных внешних ключах.
 */

const sql = postgres(testDatabaseUrl(), { max: 2 });

let restaurantId: string;
let otherId: string;

beforeAll(async () => {
  restaurantId = await createRestaurant(sql, "menu-repo");
  otherId = await createRestaurant(sql, "menu-repo-other");
});

afterAll(async () => {
  await dropRestaurant(sql, restaurantId);
  await dropRestaurant(sql, otherId);
  await sql.end();
});

function category(nameDe: string, sortOrder = 0) {
  return { nameDe, nameRu: nameDe, nameEn: nameDe, sortOrder };
}

function item(categoryId: string, nameDe: string) {
  return {
    categoryId,
    nameDe,
    nameRu: nameDe,
    nameEn: nameDe,
    descriptionDe: null,
    descriptionRu: null,
    descriptionEn: null,
    priceCents: 950,
    allergens: ["celery" as const],
    aliases: ["alias"],
    isVegetarian: true,
    isVegan: false,
    isAvailable: true,
    prepMinutes: 15,
  };
}

describe("репозиторий меню", () => {
  it("создаёт, читает и меняет категорию", async () => {
    const created = await createCategory(
      sql,
      restaurantId,
      category("Crud", 5),
    );
    expect(created).toMatchObject({ nameDe: "Crud", sortOrder: 5 });

    const updated = await updateCategory(sql, restaurantId, created.id, {
      ...category("Crud", 1),
      nameRu: "Крад",
    });
    expect(updated).toMatchObject({ nameRu: "Крад", sortOrder: 1 });

    expect(
      (await listCategories(sql, restaurantId)).map((row) => row.id),
    ).toContain(created.id);

    expect(await deleteCategory(sql, restaurantId, created.id)).toBe(true);
  });

  it("создаёт и меняет блюдо со всеми полями", async () => {
    const parent = await createCategory(sql, restaurantId, category("Items"));
    const created = await createItem(
      sql,
      restaurantId,
      item(parent.id, "Suppe"),
    );
    expect(created).toMatchObject({
      nameDe: "Suppe",
      priceCents: 950,
      allergens: ["celery"],
      aliases: ["alias"],
      isVegetarian: true,
      isAvailable: true,
      prepMinutes: 15,
    });
    if (!created) {
      throw new Error("блюдо не создалось");
    }

    const updated = await updateItem(sql, restaurantId, created.id, {
      ...item(parent.id, "Suppe"),
      priceCents: 1250,
      isVegan: true,
      isAvailable: false,
      descriptionRu: "Суп дня",
    });
    expect(updated).toMatchObject({
      priceCents: 1250,
      isVegan: true,
      isAvailable: false,
      descriptionRu: "Суп дня",
    });

    await deleteItem(sql, restaurantId, created.id);
    await deleteCategory(sql, restaurantId, parent.id);
  });

  it("отдаёт блюда только своего ресторана", async () => {
    const mine = await createCategory(sql, restaurantId, category("Mine"));
    const theirs = await createCategory(sql, otherId, category("Theirs"));
    const created = await createItem(sql, restaurantId, item(mine.id, "Only"));
    if (!created) {
      throw new Error("блюдо не создалось");
    }

    try {
      expect(
        (await listItems(sql, otherId)).some((row) => row.id === created.id),
      ).toBe(false);

      // Чужой ресторан не может ни изменить блюдо, ни удалить его.
      expect(
        await updateItem(sql, otherId, created.id, item(theirs.id, "Stolen")),
      ).toBeUndefined();
      expect(await deleteItem(sql, otherId, created.id)).toBe(false);
    } finally {
      await deleteItem(sql, restaurantId, created.id);
      await deleteCategory(sql, restaurantId, mine.id);
      await deleteCategory(sql, otherId, theirs.id);
    }
  });

  it("не создаёт блюдо в чужой категории", async () => {
    const theirs = await createCategory(sql, otherId, category("Foreign"));
    try {
      expect(
        await createItem(sql, restaurantId, item(theirs.id, "Sneaky")),
      ).toBeUndefined();
      expect(await listItems(sql, otherId)).toHaveLength(0);
    } finally {
      await deleteCategory(sql, otherId, theirs.id);
    }
  });

  it("не даёт удалить непустую категорию", async () => {
    const parent = await createCategory(sql, restaurantId, category("Busy"));
    const created = await createItem(
      sql,
      restaurantId,
      item(parent.id, "Kept"),
    );
    if (!created) {
      throw new Error("блюдо не создалось");
    }

    try {
      // 23001 restrict_violation — ответ Postgres на ON DELETE RESTRICT.
      await expect(
        deleteCategory(sql, restaurantId, parent.id),
      ).rejects.toMatchObject({ code: "23001" });
    } finally {
      await deleteItem(sql, restaurantId, created.id);
      await deleteCategory(sql, restaurantId, parent.id);
    }
  });

  it("не пускает две категории с одним немецким названием", async () => {
    const first = await createCategory(sql, restaurantId, category("Unique"));
    try {
      await expect(
        createCategory(sql, restaurantId, category("Unique")),
      ).rejects.toMatchObject({ code: "23505" });
    } finally {
      await deleteCategory(sql, restaurantId, first.id);
    }
  });

  it("не даёт сохранить веганское блюдо без вегетарианского — CHECK базы", async () => {
    const parent = await createCategory(sql, restaurantId, category("Vegan"));
    try {
      await expect(
        createItem(sql, restaurantId, {
          ...item(parent.id, "Broken"),
          isVegetarian: false,
          isVegan: true,
        }),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await deleteCategory(sql, restaurantId, parent.id);
    }
  });

  it("сортирует категории по порядку, потом по немецкому названию", async () => {
    const local = await createRestaurant(sql, "menu-sort");
    try {
      await createCategory(sql, local, category("Zuletzt", 9));
      await createCategory(sql, local, category("Beta", 1));
      await createCategory(sql, local, category("Alpha", 1));

      expect(
        (await listCategories(sql, local)).map((row) => row.nameDe),
      ).toEqual(["Alpha", "Beta", "Zuletzt"]);
    } finally {
      await dropRestaurant(sql, local);
    }
  });
});
