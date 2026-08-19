import { inference, type VAD } from "@livekit/agents";
import type { Room } from "@livekit/rtc-node";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import {
  buildSessionOptions,
  buildStartOptions,
  buildStt,
  buildTts,
  createRestaurantAgent,
} from "../src/session.ts";

function config(turnDetector: "audio" | "off" = "audio") {
  return loadConfig({
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
    AGENT_TURN_DETECTOR: turnDetector,
    AGENT_MIN_ENDPOINTING_DELAY_MS: "350",
    AGENT_MAX_ENDPOINTING_DELAY_MS: "2500",
  });
}

describe("session options", () => {
  it("always disables recording in start options", () => {
    const agent = createRestaurantAgent("Testanweisung", []);
    const room = {} as Room;

    expect(buildStartOptions(agent, room)).toEqual({
      agent,
      room,
      record: false,
    });
  });

  it("copies endpointing delays and enables the local audio detector", () => {
    const options = buildSessionOptions(
      config(),
      {} as VAD,
      buildStt(config()),
      buildTts(config(), "de"),
    );

    expect(options.turnHandling?.endpointing).toMatchObject({
      mode: "fixed",
      minDelay: 350,
      maxDelay: 2_500,
    });
    expect(options.turnHandling?.turnDetection).toBeInstanceOf(
      inference.TurnDetector,
    );
    expect(options.turnHandling?.turnDetection).toMatchObject({
      model: "turn-detector-v1-mini",
    });
  });

  it("uses VAD endpointing without constructing an audio detector when disabled", () => {
    const options = buildSessionOptions(
      config("off"),
      {} as VAD,
      buildStt(config("off")),
      buildTts(config("off"), "de"),
    );

    expect(options.turnHandling?.turnDetection).toBe("vad");
  });
});
