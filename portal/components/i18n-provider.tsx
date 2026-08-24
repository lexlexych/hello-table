"use client";

import { createContext, type ReactNode, useContext } from "react";
import {
  type MessageKey,
  type PortalLocale,
  translate,
} from "@/lib/i18n/catalog";

interface I18nValue {
  locale: PortalLocale;
  t: (
    key: MessageKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({
  locale,
  children,
}: {
  locale: PortalLocale;
  children: ReactNode;
}) {
  return (
    <I18nContext.Provider
      value={{ locale, t: (key, values) => translate(locale, key, values) }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider is missing");
  return value;
}
