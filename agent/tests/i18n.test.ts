import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const requiredKeys = [
  "greeting",
  "ai_disclosure",
  "goodbye",
  "error_unavailable",
] as const;

describe("German fixed phrases", () => {
  it("contains all required non-empty phrases without unresolved placeholders", async () => {
    const path = fileURLToPath(new URL("../src/i18n/de.yaml", import.meta.url));
    const parsed: unknown = parse(await readFile(path, "utf8"));
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();

    const phrases = parsed as Record<string, unknown>;
    for (const key of requiredKeys) {
      expect(phrases[key]).toBeTypeOf("string");
      const phrase = String(phrases[key]);
      expect(phrase.trim()).not.toBe("");
      expect(phrase).not.toMatch(/\bTODO\b/i);
      expect(phrase).not.toMatch(/{{[^}]+}}/);
    }
  });
});
