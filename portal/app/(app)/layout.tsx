import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { requireSessionForPage } from "@/lib/rbac";

/**
 * Оболочка портала. Меню состоит из одного пункта: остальные разделы §7.3 приходят
 * в итерациях 9–10, а заглушек проект не заводит (PROJECT.md §0.2).
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
          {/* Пока раздел один, он же всегда текущий. */}
          <Link href="/test-call" aria-current="page">
            Тестовый звонок
          </Link>
        </nav>
        <main className="shell-main">{children}</main>
      </div>
    </div>
  );
}
