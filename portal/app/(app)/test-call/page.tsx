import { TestCallPanel } from "@/components/test-call-panel";
import { requireSessionForPage } from "@/lib/rbac";

export default async function TestCallPage() {
  // Страница доступна обеим ролям (PROJECT.md §7.2); маршрут выдачи токена проверяет роль сам.
  await requireSessionForPage(["admin", "operator"]);

  return (
    <>
      <h1>Тестовый звонок</h1>
      <TestCallPanel />
    </>
  );
}
