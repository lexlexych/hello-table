import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { voice } from "@livekit/agents";
import type { Room } from "@livekit/rtc-node";
import { describe, expect, it, vi } from "vitest";
import type { DisclosureSession } from "../src/startup.ts";
import { startSessionWithDisclosure } from "../src/startup.ts";

function startOptions() {
  return {
    agent: {} as voice.Agent,
    room: {} as Room,
    record: false as const,
  };
}

describe("disclosure startup orchestration", () => {
  it("keeps audio disabled until the non-interruptible disclosure finishes", async () => {
    const events: string[] = [];
    let finishPlayout: (() => void) | undefined;
    const playout = new Promise<void>((resolve) => {
      finishPlayout = resolve;
    });
    const say = vi.fn(() => ({
      waitForPlayout: async () => {
        events.push("playout:start");
        await playout;
        events.push("playout:end");
      },
    }));
    const session: DisclosureSession = {
      input: {
        setAudioEnabled: (enabled) => events.push(`audio:${enabled}`),
      },
      start: async () => {
        events.push("start");
      },
      say,
    };

    const task = startSessionWithDisclosure(
      session,
      startOptions(),
      "KI-Hinweis. Guten Tag.",
    );
    await vi.waitFor(() => expect(events).toContain("playout:start"));

    expect(events).toEqual(["audio:false", "start", "playout:start"]);
    expect(say).toHaveBeenCalledWith("KI-Hinweis. Guten Tag.", {
      addToChatCtx: false,
      allowInterruptions: false,
    });

    finishPlayout?.();
    await task;
    expect(events).toEqual([
      "audio:false",
      "start",
      "playout:start",
      "playout:end",
      "audio:true",
    ]);
  });

  it("restores audio when session startup fails", async () => {
    const events: string[] = [];
    const session: DisclosureSession = {
      input: {
        setAudioEnabled: (enabled) => events.push(`audio:${enabled}`),
      },
      start: async () => {
        events.push("start");
        throw new Error("synthetic startup failure");
      },
      say: () => ({ waitForPlayout: async () => undefined }),
    };

    await expect(
      startSessionWithDisclosure(session, startOptions(), "KI-Hinweis"),
    ).rejects.toThrow(/synthetic startup failure/);
    expect(events).toEqual(["audio:false", "start", "audio:true"]);
  });

  it("restores audio when disclosure playout fails", async () => {
    const setAudioEnabled = vi.fn();
    const session: DisclosureSession = {
      input: { setAudioEnabled },
      start: async () => undefined,
      say: () => ({
        waitForPlayout: async () => {
          throw new Error("synthetic playout failure");
        },
      }),
    };

    await expect(
      startSessionWithDisclosure(session, startOptions(), "KI-Hinweis"),
    ).rejects.toThrow(/synthetic playout failure/);
    expect(setAudioEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setAudioEnabled).toHaveBeenNthCalledWith(2, true);
  });
});

describe("runtime configuration process boundary", () => {
  it("fails before a LiveKit connection when a required variable is missing", () => {
    const entrypoint = fileURLToPath(
      new URL("../src/bootstrap.ts", import.meta.url),
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      LIVEKIT_API_KEY: "test-key",
      LIVEKIT_API_SECRET: "secret-value-must-not-appear",
      RESTAURANT_ID: "10000000-0000-0000-0000-000000000001",
      AGENT_DATABASE_URL:
        "postgres://agent_app:test-password@localhost:55432/restaurant",
      LOG_LEVEL: "info",
    };
    delete env.OPENAI_API_KEY;

    const result = spawnSync(
      process.execPath,
      ["--enable-source-maps", entrypoint, "dev"],
      {
        encoding: "utf8",
        env,
        timeout: 10_000,
      },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain("OPENAI_API_KEY");
    expect(output).not.toContain("secret-value-must-not-appear");
    expect(output).not.toMatch(/worker registered|connecting to room/i);
  });
});
