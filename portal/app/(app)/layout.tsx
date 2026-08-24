import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { db } from "@/lib/db";
import { translate } from "@/lib/i18n/catalog";
import { getPortalLocale } from "@/lib/i18n/server";
import { countNewCallbackMessages } from "@/lib/messages";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";

/**
 * Оболочка портала. Разделы §7.3 появляются по мере реализации; заглушек проект
 * не заводит (PROJECT.md §0.2). Справочники видны обеим ролям — оператор читает их,
 * чтобы отвечать гостю по телефону (§7.2).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSessionForPage();
  const locale = await getPortalLocale();
  const sql = db();
  const newMessages = await countNewCallbackMessages(
    sql,
    await getRestaurantId(sql),
  );

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-title">{translate(locale, "app.title")}</span>
        <span className="shell-spacer" />
        <span className="shell-user">
          {session.username}
          <span className="role-badge">
            {translate(locale, `role.${session.role}`)}
          </span>
        </span>
        <LogoutButton />
      </header>
      <div className="shell-body">
        <nav className="shell-nav">
          <NavLink href="/test-call">
            {translate(locale, "nav.testCall")}
          </NavLink>
          <NavLink href="/tables">{translate(locale, "nav.tables")}</NavLink>
          <NavLink href="/pickup">{translate(locale, "nav.pickup")}</NavLink>
          <NavLink href="/messages">
            <span className="nav-label">
              {translate(locale, "nav.messages")}
            </span>
            {newMessages > 0 ? (
              <span
                className="nav-count"
                role="status"
                aria-label={translate(locale, "nav.newMessages", {
                  count: newMessages,
                })}
              >
                {newMessages}
              </span>
            ) : null}
          </NavLink>
          <NavLink href="/menu">{translate(locale, "nav.menu")}</NavLink>
          {session.role === "admin" ? (
            <NavLink href="/settings">
              {translate(locale, "nav.settings")}
            </NavLink>
          ) : null}
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
