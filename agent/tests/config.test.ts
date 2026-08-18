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
    N8N_BASE_URL: "http://localhost:5678",
    N8N_WEBHOOK_SECRET: "0123456789abcdef0123456789abcdef",
  };
}

describe("loadConfig", () => {
  it("parses a valid configuration and applies defaults", () => {
    const config = loadConfig(validEnv());

    expect(config.AGENT_LANGUAGE).toBe("de");
    expect(config.AGENT_TURN_DETECTOR).toBe("multilingual");
    expect(config.AGENT_MIN_ENDPOINTING_DELAY_MS).toBe(500);
    expect(config.AGENT_MAX_ENDPOINTING_DELAY_MS).toBe(3_000);
    expect(config.STT_MODEL).toBe("voxtral-mini-transcribe-realtime-2602");
    expect(config.LLM_MODEL).toBe("mistral-large-latest");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.N8N_TIMEOUT_MS).toBe(8_000);
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
    expect(() => loadConfig({ ...validEnv(), AGENT_LANGUAGE: "en" })).toThrow(
      /AGENT_LANGUAGE/,
    );
  });
});
