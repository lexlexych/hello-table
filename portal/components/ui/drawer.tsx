"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { useI18n } from "@/components/i18n-provider";

/**
 * Боковая панель формы. Открывается и закрывается родителем: панель не знает,
 * что внутри, и не решает, когда ей быть.
 *
 * Что делает сама: закрытие по Esc и по клику в затемнение, возврат фокуса на элемент,
 * с которого её открыли, и удержание фокуса внутри, пока она открыта.
 */
export function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const node = panel.current;

    function focusable(): HTMLElement[] {
      if (!node) {
        return [];
      }
      return [
        ...node.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ];
    }

    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      // Tab по кругу: без этого фокус уходит на страницу под затемнением.
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, [onClose]);

  return (
    <>
      {/* Затемнение закрывает панель мышью; с клавиатуры это делает Esc выше. */}
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
      >
        <div className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        <div className="drawer-foot">{footer}</div>
      </div>
    </>
  );
}
