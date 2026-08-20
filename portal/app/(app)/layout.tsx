import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { db } from "@/lib/db";
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
  const sql = db();
  const newMessages = await countNewCallbackMessages(
    sql,
    await getRestaurantId(sql),
  );

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-title">Портал ресторана</span>
        <span className="shell-spacer" />
        <span className="shell-user">
          {session.username}
          <span className="role-badge">{session.role}</span>
        </span>
        <LogoutButton />
      </header>
      <div className="shell-body">
        <nav className="shell-nav">
          <NavLink href="/test-call">Тестовый звонок</NavLink>
          <NavLink href="/tables">Столики</NavLink>
          <NavLink href="/pickup">Самовывоз</NavLink>
          <NavLink href="/messages">
            <span className="nav-label">Сообщения</span>
            {newMessages > 0 ? (
              <span
                className="nav-count"
                aria-label={`Новых сообщений: ${newMessages}`}
              >
                {newMessages}
              </span>
            ) : null}
          </NavLink>
          <NavLink href="/menu">Меню</NavLink>
          {session.role === "admin" ? (
            <NavLink href="/settings">Настройки</NavLink>
          ) : null}
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
