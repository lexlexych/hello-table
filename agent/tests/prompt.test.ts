import { describe, expect, it } from "vitest";
import { loadSystemPrompt } from "../src/session.ts";

describe("German system prompt", () => {
  it("requires short replies and forbids invented restaurant data", async () => {
    const prompt = await loadSystemPrompt();

    expect(prompt).not.toBe("");
    expect(prompt).toMatch(/ein bis zwei kurzen Sätzen/i);
    expect(prompt).toMatch(/Erfinde niemals Gerichte, Preise.*freie Tische/is);
    expect(prompt).toMatch(/keine Werkzeuge.*keine Buchungsfunktion/is);
    expect(prompt).toMatch(/immer auf Deutsch/i);
  });
});
