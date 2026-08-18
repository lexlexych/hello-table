import { describe, expect, it } from "vitest";
import {
  ALLERGEN_LABELS,
  ALLERGENS,
  categoryInputSchema,
  centsToInput,
  formatEuros,
  menuItemInputSchema,
  parseEuros,
} from "@/lib/schemas/menu";
import { tableInputSchema } from "@/lib/schemas/tables";

/**
 * Схемы форм повторяют CHECK из миграций 002 и 003. Тест сторожит именно это
 * совпадение: если границы в базе поменяются, а здесь нет, форма начнёт пропускать
 * значения, которые база отвергнет уже после нажатия «Сохранить».
 */

const VALID_TABLE = {
  label: "T1",
  seats: 4,
  zone: "Terrasse",
  isActive: true,
  combinable: false,
};

const VALID_ITEM = {
  categoryId: "00000000-0000-0000-0000-000000000001",
  nameDe: "Suppe",
  nameRu: "Суп",
  nameEn: "Soup",
  descriptionDe: "",
  descriptionRu: "",
  descriptionEn: "",
  priceCents: 950,
  allergens: ["celery"],
  aliases: ["Tagessuppe"],
  isVegetarian: true,
  isVegan: false,
  isAvailable: true,
  prepMinutes: 15,
};

describe("схема столика", () => {
  it("принимает корректный столик", () => {
    expect(tableInputSchema.parse(VALID_TABLE)).toMatchObject({
      label: "T1",
      seats: 4,
      zone: "Terrasse",
    });
  });

  it("обрезает пробелы в метке и отвергает пустую", () => {
    expect(
      tableInputSchema.parse({ ...VALID_TABLE, label: "  T7  " }).label,
    ).toBe("T7");
    expect(
      tableInputSchema.safeParse({ ...VALID_TABLE, label: "   " }).success,
    ).toBe(false);
  });

  it("держит число мест в границах CHECK(seats BETWEEN 1 AND 50)", () => {
    for (const seats of [0, 51, 2.5]) {
      expect(
        tableInputSchema.safeParse({ ...VALID_TABLE, seats }).success,
      ).toBe(false);
    }
    expect(
      tableInputSchema.safeParse({ ...VALID_TABLE, seats: 50 }).success,
    ).toBe(true);
  });

  it("превращает пустую зону в NULL, а не в пустую строку", () => {
    expect(tableInputSchema.parse({ ...VALID_TABLE, zone: "  " }).zone).toBe(
      null,
    );
  });
});

describe("схема категории", () => {
  it("требует названия на всех трёх языках", () => {
    const base = {
      nameDe: "Vorspeisen",
      nameRu: "Закуски",
      nameEn: "",
      sortOrder: 0,
    };
    expect(categoryInputSchema.safeParse(base).success).toBe(false);
    expect(
      categoryInputSchema.safeParse({ ...base, nameEn: "Starters" }).success,
    ).toBe(true);
  });

  it("не принимает отрицательный порядок", () => {
    expect(
      categoryInputSchema.safeParse({
        nameDe: "A",
        nameRu: "Б",
        nameEn: "C",
        sortOrder: -1,
      }).success,
    ).toBe(false);
  });
});

describe("схема блюда", () => {
  it("принимает корректное блюдо", () => {
    expect(menuItemInputSchema.safeParse(VALID_ITEM).success).toBe(true);
  });

  it("повторяет CHECK(NOT is_vegan OR is_vegetarian)", () => {
    const vegan = { ...VALID_ITEM, isVegan: true, isVegetarian: false };
    expect(menuItemInputSchema.safeParse(vegan).success).toBe(false);
    expect(
      menuItemInputSchema.safeParse({ ...vegan, isVegetarian: true }).success,
    ).toBe(true);
  });

  it("пропускает только аллергены из списка базы", () => {
    expect(
      menuItemInputSchema.safeParse({ ...VALID_ITEM, allergens: ["honey"] })
        .success,
    ).toBe(false);
    expect(
      menuItemInputSchema.safeParse({
        ...VALID_ITEM,
        allergens: [...ALLERGENS],
      }).success,
    ).toBe(true);
  });

  it("убирает повторы и пустые значения из синонимов", () => {
    const parsed = menuItemInputSchema.parse({
      ...VALID_ITEM,
      aliases: ["Pizza", " Pizza ", "  ", "Salami"],
    });
    expect(parsed.aliases).toEqual(["Pizza", "Salami"]);
  });

  it("держит время приготовления в границах 0…240", () => {
    for (const prepMinutes of [-1, 241]) {
      expect(
        menuItemInputSchema.safeParse({ ...VALID_ITEM, prepMinutes }).success,
      ).toBe(false);
    }
  });

  it("превращает пустое описание в NULL", () => {
    expect(menuItemInputSchema.parse(VALID_ITEM).descriptionDe).toBe(null);
  });

  it("отвергает цену с дробной частью в центах", () => {
    expect(
      menuItemInputSchema.safeParse({ ...VALID_ITEM, priceCents: 12.5 })
        .success,
    ).toBe(false);
  });

  it("у каждого аллергена есть русская подпись", () => {
    for (const allergen of ALLERGENS) {
      expect(ALLERGEN_LABELS[allergen]).toBeTruthy();
    }
  });
});

describe("цена", () => {
  it("понимает и запятую, и точку", () => {
    expect(parseEuros("12,50")).toBe(1250);
    expect(parseEuros("12.50")).toBe(1250);
    expect(parseEuros("8")).toBe(800);
    expect(parseEuros(" 19,99 ")).toBe(1999);
  });

  it("не теряет цент на двоичном округлении", () => {
    expect(parseEuros("19,99")).toBe(1999);
    expect(parseEuros("0,07")).toBe(7);
  });

  it("отвергает то, что ценой не является", () => {
    for (const value of ["", "abc", "1,234", "-5", "1,2,3"]) {
      expect(parseEuros(value)).toBeUndefined();
    }
  });

  it("показывает цену по-немецки и возвращает её в поле ввода", () => {
    // В немецкой локали разделитель — запятая, а пробел перед € неразрывный.
    expect(formatEuros(1250)).toMatch(/^12,50/);
    expect(centsToInput(1250)).toBe("12,50");
    expect(centsToInput(800)).toBe("8,00");
  });
});
