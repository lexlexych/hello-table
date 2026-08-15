import { describe, expect, it, vi } from "vitest";
import {
  downloadPluginSpecifiers,
  startDownloadFiles,
} from "../src/download.ts";

const events = vi.hoisted((): string[] => []);

vi.mock("@livekit/agents-plugin-silero", () => {
  events.push("plugin:@livekit/agents-plugin-silero");
  return {};
});

vi.mock("@livekit/agents-plugin-livekit", () => {
  events.push("plugin:@livekit/agents-plugin-livekit");
  return {};
});

describe("download-files plugin registration", () => {
  it("registers Silero and turn-detector assets before starting the config-free CLI", async () => {
    const runCli = vi.fn(async () => {
      events.push("cli");
    });

    expect(process.env.MISTRAL_API_KEY).toBeUndefined();
    expect(process.env.ELEVENLABS_API_KEY).toBeUndefined();
    expect(process.env.LIVEKIT_API_SECRET).toBeUndefined();

    await startDownloadFiles(undefined, runCli);

    expect(downloadPluginSpecifiers).toEqual([
      "@livekit/agents-plugin-silero",
      "@livekit/agents-plugin-livekit",
    ]);
    expect(events).toEqual([
      "plugin:@livekit/agents-plugin-silero",
      "plugin:@livekit/agents-plugin-livekit",
      "cli",
    ]);
  });
});
