import { TestCallPanel } from "@/components/test-call-panel";
import { translate } from "@/lib/i18n/catalog";
import { getPortalLocale } from "@/lib/i18n/server";
import { requireSessionForPage } from "@/lib/rbac";

export default async function TestCallPage() {
  // Страница доступна обеим ролям (PROJECT.md §7.2); маршрут выдачи токена проверяет роль сам.
  await requireSessionForPage(["admin", "operator"]);
  const locale = await getPortalLocale();

  return (
    <>
      <h1>{translate(locale, "testCall.title")}</h1>
      <TestCallPanel />
    </>
  );
}
