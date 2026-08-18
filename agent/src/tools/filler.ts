/** Минимум, который нужен инструменту от сессии, чтобы произнести филлер-фразу. */
export interface FillerSpeaker {
  say(
    text: string,
    options?: { addToChatCtx?: boolean; allowInterruptions?: boolean },
  ): unknown;
}

/**
 * Произносит короткую фразу непосредственно перед обращением к базе.
 *
 * Это хук в коде, а не строка в промпте: модель может забыть фразу, и гость услышит
 * тишину в течение вызова инструмента.
 */
export async function withFiller<T>(
  speaker: FillerSpeaker | undefined,
  phrase: string,
  call: () => Promise<T>,
): Promise<T> {
  speaker?.say(phrase, { addToChatCtx: false, allowInterruptions: true });
  return call();
}
