import type { Language } from "@hello-table/contracts";

const LOCALES: Record<Language, string> = {
  de: "de-DE",
  ru: "ru-RU",
  en: "en-GB",
};

/** Форматирует цену для языка разговора до передачи её модели (§4.2). */
export function formatPrice(cents: number, language: Language): string {
  return new Intl.NumberFormat(LOCALES[language], {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
