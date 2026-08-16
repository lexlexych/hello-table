import { EventEmitter } from "node:events";
import type {
  EOUMetrics,
  JobContext,
  LLMMetrics,
  STTMetrics,
  TTSMetrics,
  VADMetrics,
  voice,
} from "@livekit/agents";
import { AgentSessionEventTypes } from "@livekit/agents";
import { describe, expect, it } from "vitest";
import {
  attachTelemetry,
  createTurnMetricsCollector,
  summarizeSession,
  summarizeTurn,
  type TranscriptRecord,
  type TurnLatencyRecord,
} from "../src/telemetry.ts";

function metrics(speechId = "speech-1"): [EOUMetrics, LLMMetrics, TTSMetrics] {
  const eou: EOUMetrics = {
    type: "eou_metrics",
    timestamp: 1,
    endOfUtteranceDelayMs: 400,
    transcriptionDelayMs: 120,
    onUserTurnCompletedDelayMs: 0,
    lastSpeakingTimeMs: 1,
    speechId,
  };
  const llm: LLMMetrics = {
    type: "llm_metrics",
    label: "fake",
    requestId: "request-1",
    timestamp: 2,
    durationMs: 250,
    ttftMs: 200,
    cancelled: false,
    completionTokens: 10,
    promptTokens: 20,
    promptCachedTokens: 0,
    totalTokens: 30,
    tokensPerSecond: 40,
    speechId,
  };
  const tts: TTSMetrics = {
    type: "tts_metrics",
    label: "fake",
    requestId: "request-2",
    timestamp: 3,
    ttfbMs: 180,
    durationMs: 300,
    audioDurationMs: 1_000,
    cancelled: false,
    charactersCount: 42,
    streamed: true,
    speechId,
  };
  return [eou, llm, tts];
}

function vadMetric(): VADMetrics {
  return {
    type: "vad_metrics",
    label: "fake",
    timestamp: 0,
    idleTimeMs: 10,
    inferenceDurationTotalMs: 2,
    inferenceCount: 1,
  };
}

function sttMetric(): STTMetrics {
  return {
    type: "stt_metrics",
    label: "fake",
    requestId: "request-stt",
    timestamp: 0,
    durationMs: 5,
    audioDurationMs: 100,
    streamed: true,
  };
}

function containsString(value: unknown): boolean {
  if (typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(containsString);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(containsString);
  }
  return false;
}

describe("latency telemetry", () => {
  it("sums the four perceived latency stages", () => {
    expect(summarizeTurn(metrics())).toEqual({
      endOfUtteranceDelayMs: 400,
      transcriptionDelayMs: 120,
      llmTtftMs: 200,
      ttsTtfbMs: 180,
      totalMs: 900,
    });
  });

  it("returns null for an incomplete turn", () => {
    expect(summarizeTurn(metrics().slice(0, 2))).toBeNull();
  });

  it("computes p50 and maximum and contains no string values", () => {
    const first = summarizeTurn(metrics());
    if (first === null) {
      throw new Error("expected complete turn metrics");
    }
    const second = { ...first, totalMs: 1_200, llmTtftMs: 500 };
    const summary = summarizeSession([first, second]);

    expect(summary.turnCount).toBe(2);
    expect(summary.total).toEqual({ p50Ms: 900, maxMs: 1_200 });
    expect(summary.llmTtft).toEqual({ p50Ms: 200, maxMs: 500 });
    expect(containsString(summary)).toBe(false);
  });

  it("opens only on EOU, ignores standalone metrics, and bounds incomplete turns", () => {
    const collector = createTurnMetricsCollector();
    const [eouOne, llmOne, ttsOne] = metrics("speech-1");
    const [eouTwo, llmTwo, ttsTwo] = metrics("speech-2");

    expect(collector.add(vadMetric())).toBeNull();
    expect(collector.add(sttMetric())).toBeNull();
    expect(collector.add(ttsOne)).toBeNull();
    expect(collector.pendingMetricCount()).toBe(0);

    expect(collector.add(eouOne)).toBeNull();
    expect(collector.add(llmOne)).toBeNull();
    expect(collector.activeSpeechId()).toBe("speech-1");
    expect(collector.pendingMetricCount()).toBe(2);

    // A new user EOU replaces the incomplete prior turn instead of accumulating buckets.
    expect(collector.add(eouTwo)).toBeNull();
    expect(collector.activeSpeechId()).toBe("speech-2");
    expect(collector.pendingMetricCount()).toBe(1);
    expect(collector.add(ttsOne)).toBeNull();
    expect(collector.pendingMetricCount()).toBe(1);
    expect(collector.add(llmTwo)).toBeNull();
    expect(collector.add(ttsTwo)).toEqual({
      endOfUtteranceDelayMs: 400,
      transcriptionDelayMs: 120,
      llmTtftMs: 200,
      ttsTtfbMs: 180,
      totalMs: 900,
    });
    expect(collector.activeSpeechId()).toBeUndefined();
    expect(collector.pendingMetricCount()).toBe(0);
  });

  it("attaches only numeric turn telemetry and emits it at close", () => {
    const emitter = new EventEmitter();
    const snapshots: unknown[] = [];
    attachTelemetry(
      emitter as unknown as voice.AgentSession,
      {} as JobContext<undefined>,
      {
        readRss: () => 123,
        writeSummary: (snapshot) => snapshots.push(snapshot),
      },
    );

    for (const metric of [vadMetric(), sttMetric(), ...metrics()]) {
      emitter.emit(AgentSessionEventTypes.MetricsCollected, {
        metrics: metric,
      });
    }
    emitter.emit(AgentSessionEventTypes.Close, {});

    expect(snapshots).toEqual([
      {
        latency: summarizeSession([
          {
            endOfUtteranceDelayMs: 400,
            transcriptionDelayMs: 120,
            llmTtftMs: 200,
            ttsTtfbMs: 180,
            totalMs: 900,
          },
        ]),
        rssBytes: 123,
      },
    ]);
    expect(containsString(snapshots)).toBe(false);
  });

  it("writes one numeric latency line per completed turn", () => {
    const emitter = new EventEmitter();
    const records: TurnLatencyRecord[] = [];
    attachTelemetry(
      emitter as unknown as voice.AgentSession,
      {} as JobContext<undefined>,
      { writeTurn: (record) => records.push(record), writeSummary: () => {} },
    );

    for (const metric of [...metrics("speech-1"), ...metrics("speech-2")]) {
      emitter.emit(AgentSessionEventTypes.MetricsCollected, {
        metrics: metric,
      });
    }

    expect(records).toEqual([
      {
        turn: 1,
        endOfUtteranceDelayMs: 400,
        transcriptionDelayMs: 120,
        llmTtftMs: 200,
        ttsTtfbMs: 180,
        totalMs: 900,
      },
      {
        turn: 2,
        endOfUtteranceDelayMs: 400,
        transcriptionDelayMs: 120,
        llmTtftMs: 200,
        ttsTtfbMs: 180,
        totalMs: 900,
      },
    ]);
    expect(containsString(records)).toBe(false);
  });

  it("never observes transcript text unless logging is explicitly enabled", () => {
    const emitter = new EventEmitter();
    const transcripts: TranscriptRecord[] = [];
    attachTelemetry(
      emitter as unknown as voice.AgentSession,
      {} as JobContext<undefined>,
      {
        writeTranscript: (record) => transcripts.push(record),
        writeTurn: () => {},
        writeSummary: () => {},
      },
    );

    emitter.emit(AgentSessionEventTypes.UserInputTranscribed, {
      transcript: "Guten Tag",
      isFinal: true,
      language: "de",
    });
    emitter.emit(AgentSessionEventTypes.ConversationItemAdded, {
      item: { role: "assistant", textContent: "Hallo" },
    });

    expect(transcripts).toEqual([]);
  });

  it("records both chain stages when transcript logging is enabled", () => {
    const emitter = new EventEmitter();
    const transcripts: TranscriptRecord[] = [];
    attachTelemetry(
      emitter as unknown as voice.AgentSession,
      {} as JobContext<undefined>,
      {
        logTranscripts: true,
        writeTranscript: (record) => transcripts.push(record),
        writeTurn: () => {},
        writeSummary: () => {},
      },
    );

    // Промежуточный результат STT в лог не идёт — иначе одна фраза попала бы туда десятки раз.
    emitter.emit(AgentSessionEventTypes.UserInputTranscribed, {
      transcript: "Guten",
      isFinal: false,
      language: "de",
    });
    emitter.emit(AgentSessionEventTypes.UserInputTranscribed, {
      transcript: "Guten Tag",
      isFinal: true,
      language: "de",
    });
    emitter.emit(AgentSessionEventTypes.ConversationItemAdded, {
      item: { role: "user", textContent: "Guten Tag" },
    });
    emitter.emit(AgentSessionEventTypes.ConversationItemAdded, {
      item: { role: "assistant", textContent: "Hallo, wie kann ich helfen?" },
    });

    expect(transcripts).toEqual([
      { stage: "stt", text: "Guten Tag", language: "de" },
      { stage: "llm", text: "Hallo, wie kann ich helfen?" },
    ]);
  });
});
