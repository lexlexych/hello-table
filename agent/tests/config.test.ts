import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

function validEnv(): NodeJS.ProcessEnv {
  return {
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: "test-key",
    LIVEKIT_API_SECRET: "test-secret",
    MISTRAL_API_KEY: "test-mistral",
    ELEVENLABS_API_KEY: "test-elevenlabs",
    ELEVENLABS_VOICE_ID: "test-voice",
    ELEVENLABS_MODEL: "test-model",
    RESTAURANT_ID: "10000000-0000-0000-0000-000000000001",
    AGENT_DATABASE_URL:
      "postgres://agent_app:test-password@localhost:55432/restaurant",
  };
}

describe("loadConfig", () => {
  it("parses a valid configuration and applies defaults", () => {
    const config = loadConfig(validEnv());

    expect(config.AGENT_DEFAULT_LANGUAGE).toBe("de");
    expect(config.AGENT_ENABLED_LANGUAGES).toEqual(["de", "ru", "en"]);
    expect(config.AGENT_LANGUAGE_SWITCH_AFTER).toBe(2);
    expect(config.AGENT_TURN_DETECTOR).toBe("multilingual");
    expect(config.AGENT_MIN_ENDPOINTING_DELAY_MS).toBe(500);
    expect(config.AGENT_MAX_ENDPOINTING_DELAY_MS).toBe(3_000);
    expect(config.STT_MODEL).toBe("scribe_v2_realtime");
    expect(config.LLM_MODEL).toBe("mistral-large-latest");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.AGENT_DATABASE_TIMEOUT_MS).toBe(8_000);
  });

  it("reports missing fields without printing secret values", () => {
    const env = validEnv();
    delete env.MISTRAL_API_KEY;
    env.LIVEKIT_API_SECRET = "must-not-appear";

    expect(() => loadConfig(env)).toThrow(/MISTRAL_API_KEY/);
    expect(() => loadConfig(env)).not.toThrow(/must-not-appear/);
  });

  it("rejects a minimum endpoint delay greater than the maximum", () => {
    expect(() =>
      loadConfig({
        ...validEnv(),
        AGENT_MIN_ENDPOINTING_DELAY_MS: "1500",
        AGENT_MAX_ENDPOINTING_DELAY_MS: "1000",
      }),
    ).toThrow(/must not exceed AGENT_MAX_ENDPOINTING_DELAY_MS/);
  });

  it("rejects unsupported languages", () => {
    expect(() =>
      loadConfig({ ...validEnv(), AGENT_DEFAULT_LANGUAGE: "fr" }),
    ).toThrow(/AGENT_DEFAULT_LANGUAGE/);
  });
});
