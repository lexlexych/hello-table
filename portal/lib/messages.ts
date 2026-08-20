import type {
  CallbackCategory,
  CallbackContactKind,
  CallbackRequestSource,
  CallbackRequestStatus,
  Language,
} from "@hello-table/contracts";
import type postgres from "postgres";

/** Строка операторской очереди без полного транскрипта разговора. */
export interface CallbackMessage {
  id: string;
  source: CallbackRequestSource;
  contactKind: CallbackContactKind | null;
  contactValue: string | null;
  language: Language;
  summary: string;
  category: CallbackCategory;
  status: CallbackRequestStatus;
  createdAtLocal: string;
  handledBy: string | null;
}

/** Все сообщения ресторана: незакрытые первыми, внутри статуса — новые сверху. */
export async function listCallbackMessages(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<CallbackMessage[]> {
  return sql<CallbackMessage[]>`
    SELECT cr.id,
           cr.source,
           CASE cr.source WHEN 'voice' THEN 'phone' ELSE 'telegram_id' END
             AS "contactKind",
           CASE cr.source WHEN 'voice' THEN cr.caller_phone ELSE cr.telegram_user_id END
             AS "contactValue",
           cr.language,
           cr.summary,
           cr.category,
           cr.status,
           to_char(cr.created_at AT TIME ZONE r.timezone, 'DD.MM.YYYY HH24:MI')
             AS "createdAtLocal",
           cr.handled_by AS "handledBy"
    FROM callback_requests cr
    JOIN restaurants r ON r.id = cr.restaurant_id
    WHERE cr.restaurant_id = ${restaurantId}
    ORDER BY CASE cr.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
             cr.created_at DESC`;
}

export async function countNewCallbackMessages(
  sql: postgres.Sql,
  restaurantId: string,
): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM callback_requests
    WHERE restaurant_id = ${restaurantId} AND status = 'new'`;
  return row?.count ?? 0;
}

export interface ChangedCallbackMessage {
  id: string;
  status: CallbackRequestStatus;
}

/**
 * Меняет только операционный статус. При взятии в работу запоминает пользователя;
 * handled_at появляется лишь в done, чтобы срок удаления отсчитывался от обработки.
 */
export async function updateCallbackMessageStatus(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
  status: CallbackRequestStatus,
  username: string,
): Promise<ChangedCallbackMessage | undefined> {
  const [row] = await sql<ChangedCallbackMessage[]>`
    UPDATE callback_requests
    SET status = ${status},
        handled_by = CASE WHEN ${status} = 'new' THEN NULL ELSE ${username} END,
        handled_at = CASE WHEN ${status} = 'done' THEN now() ELSE NULL END
    WHERE id = ${id} AND restaurant_id = ${restaurantId}
    RETURNING id, status`;
  return row;
}

/** Физически удаляет одну карточку через точечную RPC; table-level DELETE у портала нет. */
export async function deleteCallbackMessage(
  sql: postgres.Sql,
  restaurantId: string,
  id: string,
): Promise<boolean> {
  const [row] = await sql<{ removed: boolean }[]>`
    SELECT delete_callback_request(
      ${restaurantId}::uuid,
      ${id}::uuid
    ) AS removed`;
  return row?.removed ?? false;
}
