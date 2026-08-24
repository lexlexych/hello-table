import { z } from "zod";

/**
 * Границы повторяют CHECK из `db/migrations/003_menu.sql`. Как и для столиков,
 * схема одна на создание и изменение: форма отправляет сущность целиком.
 */

/** Ровно тот список, что разрешён CHECK на menu_items.allergens (Anlage II LMIV). */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type Allergen = (typeof ALLERGENS)[number];

/** Русские подписи для интерфейса портала; в базе аллергены хранятся кодами. */
export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: "глютен",
  crustaceans: "ракообразные",
  eggs: "яйца",
  fish: "рыба",
  peanuts: "арахис",
  soybeans: "соя",
  milk: "молоко",
  nuts: "орехи",
  celery: "сельдерей",
  mustard: "горчица",
  sesame: "кунжут",
  sulphites: "сульфиты",
  lupin: "люпин",
  molluscs: "моллюски",
};

export const LANGUAGES = ["de", "ru", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

const trimmed = z.string().trim();
const name = trimmed.min(1, "Заполните название на всех трёх языках").max(120);
const description = trimmed
  .max(600)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

/** Список без пустых строк и без повторов: и то и другое пользователь создаёт случайно. */
function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export const categoryInputSchema = z.object({
  nameDe: name,
  nameRu: name,
  nameEn: name,
  sortOrder: z.int().min(0).max(999),
});

export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const menuItemInputSchema = z
  .object({
    // `z.guid()`, а не `z.uuid()`: последний требует битов версии RFC 9562, а в базе
    // лежат в том числе рукописные идентификаторы из `db/seed.sql`.
    categoryId: z.guid(),
    nameDe: name,
    nameRu: name,
    nameEn: name,
    descriptionDe: description,
    descriptionRu: description,
    descriptionEn: description,
    priceCents: z.int().min(0).max(1_000_000),
    allergens: z.array(z.enum(ALLERGENS)).transform(uniqueNonEmpty),
    aliases: z.array(trimmed.max(60)).max(20).transform(uniqueNonEmpty),
    isVegetarian: z.boolean(),
    isVegan: z.boolean(),
    isAvailable: z.boolean(),
    prepMinutes: z.int().min(0).max(240),
  })
  .refine((item) => !item.isVegan || item.isVegetarian, {
    // Тот же инвариант, что и CHECK(NOT is_vegan OR is_vegetarian) в базе.
    message: "Веганское блюдо обязано быть и вегетарианским",
    path: ["isVegetarian"],
  });

export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

/**
 * Цена вводится в евро, а хранится в центах. Принимаем и запятую, и точку —
 * портал русскоязычный, а ресторан немецкий, и обе привычки живут рядом.
 * Возвращает `undefined`, если строку нельзя понять как цену.
 */
export function parseEuros(value: string): number | undefined {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return undefined;
  }
  // Округление, а не усечение: 19.99 * 100 в двоичной арифметике даёт 1998.9999….
  return Math.round(Number(normalized) * 100);
}

export function formatEuros(cents: number, locale = "de-DE"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/** Значение для поля ввода цены: без символа валюты, с запятой как разделителем. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
