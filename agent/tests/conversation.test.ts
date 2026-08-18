import { voice } from "@livekit/agents";
import { afterEach, describe, expect, it } from "vitest";
import { createGermanAgent } from "../src/session.ts";

let session: voice.AgentSession | undefined;

afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe("German prototype conversation", () => {
  it("answers through FakeLLM with the system prompt and no tools", async () => {
    const systemPrompt = "Antworte kurz auf Deutsch.";
    const fakeLlm = new voice.testing.FakeLLM([
      {
        input: "Guten Tag",
        content: "Guten Tag. Wie kann ich Ihnen helfen?",
      },
    ]);
    session = new voice.AgentSession({
      llm: fakeLlm,
      vad: null,
      turnHandling: { turnDetection: null },
    });
    const agent = createGermanAgent(systemPrompt, []);
    await session.start({ agent, record: false });

    const result = await session.run({ userInput: "Guten Tag" }).wait();

    result.expect.containsMessage({ role: "assistant" });
    expect(agent.instructions).toBe(systemPrompt);
    expect(agent.toolCtx.tools).toHaveLength(0);
    expect(result.events.some((event) => event.type === "function_call")).toBe(
      false,
    );
  });
});
