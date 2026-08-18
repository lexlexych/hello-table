import type { Phrases, SessionLanguageState } from "../session.ts";
import type { AgentDatabase } from "./database.ts";

export interface ToolDeps {
  database: AgentDatabase;
  /**
   * Язык разговора и его фразы. Ссылка, а не снимок: после переключения языка филлеры и
   * тексты ошибок обязаны звучать уже на новом языке (skills/agent-tools).
   */
  session: SessionLanguageState;
  restaurantId: string;
}

/** Результат инструмента для модели: либо данные, либо код отказа с готовой фразой. */
export type ToolReply<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; message: string };

export function failure(
  phrases: Phrases,
  error: keyof Phrases["tool_errors"],
): ToolReply<never> {
  return { ok: false, error, message: phrases.tool_errors[error] };
}
