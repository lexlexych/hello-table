import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { requireSessionForPage } from "@/lib/rbac";

/**
 * Оболочка портала. Разделы §7.3 появляются по мере реализации; заглушек проект
 * не заводит (PROJECT.md §0.2). Справочники видны обеим ролям — оператор читает их,
 * чтобы отвечать гостю по телефону (§7.2).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSessionForPage();

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
          <NavLink href="/menu">Меню</NavLink>
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
