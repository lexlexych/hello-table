import { redirect } from "next/navigation";

/** Дашборд (§7.3 п.2) появится в итерации 9; пока корень ведёт в единственный раздел. */
export default function HomePage() {
  redirect("/test-call");
}
