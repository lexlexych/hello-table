/**
 * Календарные дни в таймзоне ресторана.
 *
 * «Сегодня» обязано считаться по времени ресторана, а не по времени сервера или
 * браузера: портал может работать из другого часового пояса, и в 23:30 в Берлине
 * сервер в UTC уже показывал бы завтрашний день.
 *
 * День всюду представлен строкой `YYYY-MM-DD`. Арифметика ведётся в UTC (в нём нет
 * перехода на летнее время), поэтому «плюс сутки» никогда не даёт 23 или 25 часов
 * и не роняет дату на день назад.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Полдень UTC выбранного дня: середина суток не уезжает в соседний день ни при каком форматировании. */
function toUtcNoon(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
}

/** Строка формата `YYYY-MM-DD`, обозначающая существующую дату. */
export function isValidDay(value: string): boolean {
  if (!ISO_DAY.test(value)) {
    return false;
  }
  // Круговая проверка отсекает 2026-02-30 и 2026-13-01: Date их «исправляет».
  return toUtcNoon(value).toISOString().slice(0, 10) === value;
}

/** Сегодняшняя дата в указанной таймзоне. `en-CA` даёт ровно `YYYY-MM-DD`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftDay(iso: string, days: number): string {
  const date = toUtcNoon(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Строки сравниваются посимвольно: формат `YYYY-MM-DD` для этого и придуман. */
export function isPastDay(iso: string, today: string): boolean {
  return iso < today;
}

/**
 * День из адресной строки. Мусор и несуществующие даты молча заменяются сегодняшним
 * днём: адрес правит пользователь, и падать из-за него экран не должен.
 */
export function normalizeDay(raw: string | undefined, today: string): string {
  return raw !== undefined && isValidDay(raw) ? raw : today;
}

/** Подряд идущие дни начиная с сегодняшнего — для чипов выбора дня. */
export function nearestDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftDay(today, index));
}

/** «Сегодня» / «Завтра» / «пт, 22.08» — подпись чипа выбора дня. */
export function formatDayLabel(
  iso: string,
  today: string,
  locale = "de-DE",
): string {
  if (iso === today) {
    return locale.startsWith("ru")
      ? "Сегодня"
      : locale.startsWith("en")
        ? "Today"
        : "Heute";
  }
  if (iso === shiftDay(today, 1)) {
    return locale.startsWith("ru")
      ? "Завтра"
      : locale.startsWith("en")
        ? "Tomorrow"
        : "Morgen";
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(toUtcNoon(iso));
}

/** «18 августа 2026 г.» — полная дата для заголовка и подтверждений. */
export function formatDayFull(iso: string, locale = "de-DE"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(toUtcNoon(iso));
}
