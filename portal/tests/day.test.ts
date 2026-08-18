import { describe, expect, it } from "vitest";
import {
  formatDayFull,
  formatDayLabel,
  isPastDay,
  isValidDay,
  nearestDays,
  normalizeDay,
  shiftDay,
  todayInZone,
} from "@/lib/day";

/**
 * Дни портала. Тест сторожит две вещи, на которых легко ошибиться: «сегодня»
 * считается по времени ресторана, а не сервера, и переход на летнее время не
 * сдвигает календарные сутки.
 */

describe("todayInZone", () => {
  it("берёт дату ресторана, а не сервера", () => {
    // 22:30 UTC — в Берлине (UTC+2 летом) уже следующий день.
    const late = new Date("2026-08-18T22:30:00Z");
    expect(todayInZone("Europe/Berlin", late)).toBe("2026-08-19");
    expect(todayInZone("UTC", late)).toBe("2026-08-18");
  });

  it("работает и в обратную сторону — ранним утром UTC", () => {
    const early = new Date("2026-08-18T00:30:00Z");
    // Лос-Анджелес (UTC−7) — ещё вчерашний день.
    expect(todayInZone("America/Los_Angeles", early)).toBe("2026-08-17");
  });
});

describe("shiftDay", () => {
  it("переходит через границу месяца и года", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("не спотыкается о переход на летнее время", () => {
    // В ночь на 29.03.2026 в Европе сутки короче на час — календарный день от этого
    // не меняется, потому что арифметика ведётся в UTC.
    expect(shiftDay("2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
    expect(shiftDay("2026-10-24", 1)).toBe("2026-10-25");
  });

  it("знает про високосный год", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("isValidDay", () => {
  it("принимает существующие даты", () => {
    expect(isValidDay("2026-08-18")).toBe(true);
    expect(isValidDay("2028-02-29")).toBe(true);
  });

  it("отвергает мусор и несуществующие даты", () => {
    for (const value of [
      "",
      "2026-8-18",
      "18.08.2026",
      "2026-13-01",
      "2026-02-30",
      "2026-02-29",
      "вчера",
    ]) {
      expect(isValidDay(value)).toBe(false);
    }
  });
});

describe("normalizeDay", () => {
  it("оставляет корректный день из адреса", () => {
    expect(normalizeDay("2026-08-22", "2026-08-18")).toBe("2026-08-22");
  });

  it("подменяет мусор сегодняшним днём, а не падает", () => {
    for (const raw of [undefined, "", "не-дата", "2026-02-30"]) {
      expect(normalizeDay(raw, "2026-08-18")).toBe("2026-08-18");
    }
  });

  it("разрешает прошедший день: вчерашний зал можно посмотреть", () => {
    expect(normalizeDay("2026-08-01", "2026-08-18")).toBe("2026-08-01");
  });
});

describe("isPastDay", () => {
  it("сравнивает календарные дни, а не моменты времени", () => {
    expect(isPastDay("2026-08-17", "2026-08-18")).toBe(true);
    expect(isPastDay("2026-08-18", "2026-08-18")).toBe(false);
    expect(isPastDay("2026-08-19", "2026-08-18")).toBe(false);
    expect(isPastDay("2025-12-31", "2026-01-01")).toBe(true);
  });
});

describe("nearestDays", () => {
  it("отдаёт подряд идущие дни начиная с сегодняшнего", () => {
    expect(nearestDays("2026-08-30", 4)).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ]);
  });
});

describe("подписи дней", () => {
  it("называет сегодня и завтра словами", () => {
    expect(formatDayLabel("2026-08-18", "2026-08-18")).toBe("Сегодня");
    expect(formatDayLabel("2026-08-19", "2026-08-18")).toBe("Завтра");
  });

  it("остальные дни подписывает днём недели и датой, не уезжая на сутки", () => {
    // 22.08.2026 — суббота. Подпись форматируется в UTC, поэтому не зависит от
    // таймзоны машины, где запущен тест.
    expect(formatDayLabel("2026-08-22", "2026-08-18")).toBe("сб, 22.08");
    expect(formatDayFull("2026-08-22")).toBe("22 августа 2026 г.");
  });
});
