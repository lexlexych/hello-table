import {
  languageSchema,
  type Language,
  type VoiceMode,
} from "@hello-table/contracts";
import {
  type Phrases,
  resourceFor,
  type SessionLanguageState,
} from "../session.ts";
import type { AgentDatabase } from "./database.ts";
import type { FillerSpeaker } from "./filler.ts";
import { withFiller } from "./filler.ts";

export interface ToolDeps {
  database: AgentDatabase;
  /**
   * Язык разговора и его фразы. Ссылка, а не снимок: после переключения языка филлеры и
   * тексты ошибок обязаны звучать уже на новом языке (skills/agent-tools).
   */
  session: SessionLanguageState;
  phrasesByLanguage: Partial<Record<Language, Phrases>>;
  voiceMode: VoiceMode;
  restaurantId: string;
}

/** JSON Schema помечает язык обязательным только для Realtime tool definitions. */
export function toolLanguageParameter(voiceMode: VoiceMode) {
  const schema = languageSchema.describe(
    "Sprache des aktuellen Gesprächs (de, ru oder en)",
  );
  return voiceMode === "realtime" ? schema : schema.optional();
}

/**
 * Realtime не получает код языка из отдельного STT, поэтому модель передаёт его tool call.
 * Pipeline продолжает использовать LanguageTracker и игнорирует необязательный аргумент.
 */
export function resolveToolLanguage(
  deps: ToolDeps,
  language: Language | undefined,
): Language {
  if (deps.voiceMode === "pipeline") {
    return deps.session.language;
  }
  if (language === undefined) {
    throw new Error("Realtime tool call must include language");
  }
  deps.session.language = language;
  deps.session.phrases = resourceFor(deps.phrasesByLanguage, language);
  return language;
}

/** Pipeline announces deterministic fillers; Realtime owns its conversational timing. */
export function callWithVoiceMode<T>(
  deps: ToolDeps,
  speaker: FillerSpeaker | undefined,
  phrase: string,
  call: () => Promise<T>,
): Promise<T> {
  return deps.voiceMode === "pipeline" ? withFiller(speaker, phrase, call) : call();
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
