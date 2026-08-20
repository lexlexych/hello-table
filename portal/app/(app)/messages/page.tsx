import { MessageBoard } from "@/components/message-board";
import { db } from "@/lib/db";
import { listCallbackMessages } from "@/lib/messages";
import { requireSessionForPage } from "@/lib/rbac";
import { getRestaurantId } from "@/lib/restaurant";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  await requireSessionForPage(["admin", "operator"]);
  const sql = db();
  const messages = await listCallbackMessages(
    sql,
    await getRestaurantId(sql),
  );
  return <MessageBoard messages={messages} />;
}
