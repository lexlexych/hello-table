import {
  type AgentMetrics,
  AgentSessionEventTypes,
  type JobContext,
  log,
  type voice,
} from "@livekit/agents";

export interface TurnLatency {
  endOfUtteranceDelayMs: number;
  transcriptionDelayMs: number;
  llmTtftMs: number;
  ttsTtfbMs: number;
  totalMs: number;
}

export interface LatencyStats {
  p50Ms: number;
  maxMs: number;
}

export interface SessionLatencySummary {
  turnCount: number;
  endOfUtteranceDelay: LatencyStats;
  transcriptionDelay: LatencyStats;
  llmTtft: LatencyStats;
  ttsTtfb: LatencyStats;
  total: LatencyStats;
}

export interface TelemetrySnapshot {
  latency: SessionLatencySummary;
  rssBytes: number;
}

/** Один завершённый ход с номером по порядку — то, что пишется в лог сразу после ответа. */
export interface TurnLatencyRecord extends TurnLatency {
  turn: number;
}

/**
 * Реплика цепочки. `stage` говорит, какое звено её произвело: `stt` — распознанная речь
 * гостя, `llm` — ответ модели (он же уходит в TTS).
 */
export interface TranscriptRecord {
  stage: "stt" | "llm";
  text: string;
  language?: string;
}

export interface TelemetryDependencies {
  writeSummary?: (snapshot: TelemetrySnapshot) => void;
  writeTurn?: (record: TurnLatencyRecord) => void;
  writeTranscript?: (record: TranscriptRecord) => void;
  readRss?: () => number;
  /**
   * Разрешает писать в лог тексты реплик. По умолчанию выключено: PROJECT.md §0.4 и §11.3
   * запрещают логировать персональные данные. Включается только для отладки на синтетических
   * данных (AGENT_LOG_TRANSCRIPTS=true).
   */
  logTranscripts?: boolean;
}

export interface TurnMetricsCollector {
  add(metric: AgentMetrics): TurnLatency | null;
  activeSpeechId(): string | undefined;
  pendingMetricCount(): number;
}

/** Builds a complete latency sample only when all four relevant metric kinds are present. */
export function summarizeTurn(metrics: AgentMetrics[]): TurnLatency | null {
  const eou = metrics.find((metric) => metric.type === "eou_metrics");
  const llm = metrics.find((metric) => metric.type === "llm_metrics");
  const tts = metrics.find((metric) => metric.type === "tts_metrics");
  if (eou === undefined || llm === undefined || tts === undefined) {
    return null;
  }

  const totalMs =
    eou.endOfUtteranceDelayMs +
    eou.transcriptionDelayMs +
    llm.ttftMs +
    tts.ttfbMs;
  return {
    endOfUtteranceDelayMs: eou.endOfUtteranceDelayMs,
    transcriptionDelayMs: eou.transcriptionDelayMs,
    llmTtftMs: llm.ttftMs,
    ttsTtfbMs: tts.ttfbMs,
    totalMs,
  };
}

function stats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { p50Ms: 0, maxMs: 0 };
  }
  const ordered = [...values].sort((left, right) => left - right);
  const p50Index = Math.ceil(ordered.length * 0.5) - 1;
  return {
    p50Ms: ordered[p50Index] ?? 0,
    maxMs: ordered[ordered.length - 1] ?? 0,
  };
}

/** Produces a numeric-only summary safe to pass to structured logging. */
export function summarizeSession(turns: TurnLatency[]): SessionLatencySummary {
  return {
    turnCount: turns.length,
    endOfUtteranceDelay: stats(turns.map((turn) => turn.endOfUtteranceDelayMs)),
    transcriptionDelay: stats(turns.map((turn) => turn.transcriptionDelayMs)),
    llmTtft: stats(turns.map((turn) => turn.llmTtftMs)),
    ttsTtfb: stats(turns.map((turn) => turn.ttsTtfbMs)),
    total: stats(turns.map((turn) => turn.totalMs)),
  };
}

/**
 * Keeps at most one user turn in memory. An EOU metric is the only event that opens a turn;
 * standalone disclosure/error TTS and framework VAD/STT metrics are ignored.
 */
export function createTurnMetricsCollector(): TurnMetricsCollector {
  let active: AgentMetrics[] = [];
  let activeId: string | undefined;

  return {
    add(metric) {
      if (metric.type === "eou_metrics") {
        if (activeId !== metric.speechId) {
          active = [];
        } else {
          active = active.filter((item) => item.type !== "eou_metrics");
        }
        activeId = metric.speechId;
        active.push(metric);
      } else if (
        activeId !== undefined &&
        (metric.type === "llm_metrics" || metric.type === "tts_metrics") &&
        metric.speechId === activeId
      ) {
        active = active.filter((item) => item.type !== metric.type);
        active.push(metric);
      } else {
        return null;
      }

      const turn = summarizeTurn(active);
      if (turn !== null) {
        active = [];
        activeId = undefined;
      }
      return turn;
    },
    activeSpeechId: () => activeId,
    pendingMetricCount: () => active.length,
  };
}

/**
 * Subscribes to framework metrics and writes one numeric line per completed turn plus a summary
 * at close. Transcript text is observed only when `logTranscripts` is explicitly enabled.
 */
export function attachTelemetry<ProcessData>(
  session: voice.AgentSession,
  ctx: JobContext<ProcessData>,
  dependencies: TelemetryDependencies = {},
): void {
  void ctx;
  const turns: TurnLatency[] = [];
  const collector = createTurnMetricsCollector();
  const writeSummary =
    dependencies.writeSummary ??
    ((snapshot: TelemetrySnapshot) => {
      log().info(snapshot, "agent_session_summary");
    });
  const writeTurn =
    dependencies.writeTurn ??
    ((record: TurnLatencyRecord) => {
      log().info(record, "agent_turn_latency");
    });
  const writeTranscript =
    dependencies.writeTranscript ??
    ((record: TranscriptRecord) => {
      log().info(record, "agent_transcript");
    });
  const readRss = dependencies.readRss ?? (() => process.memoryUsage().rss);

  session.on(AgentSessionEventTypes.MetricsCollected, ({ metrics }) => {
    const turn = collector.add(metrics);
    if (turn !== null) {
      turns.push(turn);
      writeTurn({ turn: turns.length, ...turn });
    }
  });

  if (dependencies.logTranscripts === true) {
    session.on(
      AgentSessionEventTypes.UserInputTranscribed,
      ({ transcript, isFinal, language }) => {
        if (!isFinal) {
          return;
        }
        const record: TranscriptRecord = { stage: "stt", text: transcript };
        if (language !== null && language !== undefined) {
          record.language = language;
        }
        writeTranscript(record);
      },
    );

    session.on(AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
      // AgentHandoffItem не несёт текста реплики и в этом прототипе не возникает.
      if (!("role" in item) || item.role !== "assistant") {
        return;
      }
      const text = item.textContent;
      if (text === undefined || text.length === 0) {
        return;
      }
      writeTranscript({ stage: "llm", text });
    });
  }

  session.once(AgentSessionEventTypes.Close, () => {
    writeSummary({
      latency: summarizeSession(turns),
      rssBytes: readRss(),
    });
  });
}
