import { callbackRequestStatusSchema } from "@hello-table/contracts";
import { z } from "zod";

/** Статус сообщения берётся из общего контракта и совпадает с CHECK базы. */
export const messageStatusInputSchema = z.object({
  status: callbackRequestStatusSchema,
});

export type MessageStatusInput = z.infer<typeof messageStatusInputSchema>;

export const MESSAGE_STATUS_LABELS = {
  new: "Новые",
  in_progress: "В работе",
  done: "Обработаны",
} as const satisfies Record<
  z.infer<typeof callbackRequestStatusSchema>,
  string
>;

export const MESSAGE_ACTION_ERRORS: Record<string, string> = {
  invalid_body: "Неизвестный статус сообщения.",
  not_found: "Сообщение уже изменено или удалено. Обновите страницу.",
  forbidden: "Недостаточно прав.",
  unauthorized: "Сессия истекла. Войдите заново.",
  network: "Сервер недоступен. Проверьте соединение.",
};
