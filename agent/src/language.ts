import { LANGUAGES, type Language } from "@hello-table/contracts";

/**
 * Определение и переключение языка разговора — правила PROJECT.md §4.1.
 *
 * Сам язык распознаёт STT: ElevenLabs Scribe v2 realtime возвращает `language_code`, а
 * фреймворк кладёт его в `UserInputTranscribed.language`. Здесь только решается, когда
 * этому коду верить и когда менять язык сессии.
 */

const enabledLanguages: readonly string[] = LANGUAGES;

/**
 * Приводит код фреймворка (`de`, `de-DE`, `ru_RU`, `en-GB`) к языку разговора.
 * Возвращает `null` для всего, чего мы не ведём: французского, пустой строки, `undefined`.
 */
export function toLanguage(code: string | null | undefined): Language | null {
  if (code === null || code === undefined) {
    return null;
  }
  const primary = code.trim().toLowerCase().split(/[-_]/)[0];
  if (primary === undefined || !enabledLanguages.includes(primary)) {
    return null;
  }
  return primary as Language;
}

export interface LanguageTrackerOptions {
  /** Стартовый язык ресторана: на нём звучит приветствие (§4.1 п.1–2). */
  initial: Language;
  /** Языки, включённые у ресторана (§5.1 `enabled_languages`). */
  enabled: readonly Language[];
  /** Сколько подряд идущих финальных реплик на другом языке нужно для переключения. */
  switchAfter: number;
}

export interface ObserveResult {
  language: Language;
  changed: boolean;
}

/**
 * Хранит язык сессии и решает, когда его менять.
 *
 * Ключевое свойство — серия чужих реплик рвётся только репликой на текущем языке, а не
 * паузой и не нераспознанной репликой. Именно это выполняет требование §4.1 «не
 * переключаться от одного иностранного слова»: одно английское слово внутри немецкой
 * фразы даёт максимум одну чужую реплику, а следующая немецкая обнуляет счётчик.
 */
export class LanguageTracker {
  #current: Language;
  #initial: Language;
  #enabled: readonly Language[];
  #switchAfter: number;
  #streak = 0;
  #candidate: Language | undefined;
  #fixed = false;

  constructor(options: LanguageTrackerOptions) {
    if (!options.enabled.includes(options.initial)) {
      throw new Error(
        `initial language ${options.initial} is not in enabled languages ${options.enabled.join(",")}`,
      );
    }
    if (!Number.isInteger(options.switchAfter) || options.switchAfter < 1) {
      throw new Error("switchAfter must be a positive integer");
    }
    this.#current = options.initial;
    this.#initial = options.initial;
    this.#enabled = options.enabled;
    this.#switchAfter = options.switchAfter;
  }

  get current(): Language {
    return this.#current;
  }

  /**
   * Скармливать ТОЛЬКО финальные транскрипты (`isFinal === true`): промежуточные
   * результаты меняют язык по ходу фразы и дали бы ложные переключения.
   */
  observe(detected: string | null): ObserveResult {
    const language = toLanguage(detected);

    // Нераспознанный или выключенный у ресторана язык игнорируется целиком: счётчик не
    // сбрасывается, чтобы пауза или неразборчивая реплика не ломали начатую серию.
    if (language === null || !this.#enabled.includes(language)) {
      return { language: this.#current, changed: false };
    }

    // §4.1 п.3: первая распознанная реплика фиксирует язык сессии сразу, даже если он
    // отличается от стартового. Ждать порога здесь нельзя — гость услышит чужой язык.
    if (!this.#fixed) {
      this.#fixed = true;
      this.#streak = 0;
      this.#candidate = undefined;
      const changed = language !== this.#current;
      this.#current = language;
      return { language, changed };
    }

    if (language === this.#current) {
      this.#streak = 0;
      this.#candidate = undefined;
      return { language, changed: false };
    }

    this.#streak = this.#candidate === language ? this.#streak + 1 : 1;
    this.#candidate = language;

    if (this.#streak < this.#switchAfter) {
      return { language: this.#current, changed: false };
    }

    this.#streak = 0;
    this.#candidate = undefined;
    this.#current = language;
    return { language, changed: true };
  }

  reset(): void {
    this.#current = this.#initial;
    this.#streak = 0;
    this.#candidate = undefined;
    this.#fixed = false;
  }
}
