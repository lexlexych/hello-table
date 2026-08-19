import { describe, expect, it } from "vitest";
import { LanguageTracker, languageForTranscript } from "../src/language.ts";

describe("languageForTranscript", () => {
  it.each([
    ["Володя.", "de"],
    ["Один, два, три, четыре, пять, шесть, семь.", "de"],
    ["На сегодня, 21:00.", undefined],
  ])("treats a Cyrillic transcript as Russian: %s", (transcript, detected) => {
    expect(languageForTranscript(transcript, detected)).toBe("ru");
  });

  it("keeps the STT language for mixed Cyrillic and Latin text", () => {
    expect(languageForTranscript("Ich möchte борщ", "de")).toBe("de");
  });

  it("keeps the STT language when the transcript has no Cyrillic", () => {
    expect(languageForTranscript("One moment, please.", "en")).toBe("en");
  });
});

describe("LanguageTracker with the local Cyrillic check", () => {
  it("does not switch a Russian booking to German after mislabelled short replies", () => {
    const tracker = new LanguageTracker({
      initial: "ru",
      enabled: ["de", "ru", "en"],
      switchAfter: 2,
    });
    const turns = [
      ["На сегодня, 21:00.", "ru"],
      ["На пять человек.", "de"],
      ["На террасе.", "ru"],
      ["Володя.", "de"],
      ["Один, два, три, четыре, пять, шесть, семь.", "de"],
    ] as const;

    for (const [transcript, detected] of turns) {
      tracker.observe(languageForTranscript(transcript, detected));
    }

    expect(tracker.current).toBe("ru");
  });
});
