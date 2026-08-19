import type { Config } from "./config.ts";
import { loadConfig } from "./config.ts";
import type { buildStartOptions } from "./session.ts";

const runtimeCommands = new Set(["dev", "start", "connect", "console"]);

export interface DisclosureSpeechHandle {
  waitForPlayout(): Promise<void>;
}

export interface DisclosureSession {
  input: {
    setAudioEnabled(enabled: boolean): void;
  };
  start(options: ReturnType<typeof buildStartOptions>): Promise<void>;
  say(
    text: string,
    options: { addToChatCtx: false; allowInterruptions: false },
  ): DisclosureSpeechHandle;
}

export interface RealtimeDisclosureSession {
  input: {
    setAudioEnabled(enabled: boolean): void;
  };
  start(options: ReturnType<typeof buildStartOptions>): Promise<void>;
  generateReply(options: {
    instructions: string;
    allowInterruptions: true;
  }): DisclosureSpeechHandle;
}

/**
 * Runtime worker commands need all provider and LiveKit settings before loading the runner.
 * `download-files` has a separate config-free entrypoint that registers asset-owning plugins.
 */
export function validateRuntimeCommandConfig(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config | undefined {
  if (args.includes("--help") || args.includes("-h")) {
    return undefined;
  }
  return args.some((argument) => runtimeCommands.has(argument))
    ? loadConfig(env)
    : undefined;
}

/**
 * Prevents caller audio from reaching STT before the mandatory AI disclosure has completely
 * played. Audio is restored even when startup, synthesis, or playout fails.
 */
export async function startSessionWithDisclosure(
  session: DisclosureSession,
  startOptions: ReturnType<typeof buildStartOptions>,
  disclosureAndGreeting: string,
): Promise<void> {
  session.input.setAudioEnabled(false);
  try {
    await session.start(startOptions);
    const handle = session.say(disclosureAndGreeting, {
      addToChatCtx: false,
      allowInterruptions: false,
    });
    await handle.waitForPlayout();
  } finally {
    session.input.setAudioEnabled(true);
  }
}

/**
 * Realtime не имеет отдельного TTS, поэтому первую фразу генерирует сама audio-модель.
 * Вход остаётся выключенным до полного playout; `allowInterruptions: true` требуется
 * server-side turn detection, но фактически перебить реплику при выключенном входе нельзя.
 */
export async function startRealtimeSessionWithDisclosure(
  session: RealtimeDisclosureSession,
  startOptions: ReturnType<typeof buildStartOptions>,
  disclosureAndGreeting: string,
): Promise<void> {
  session.input.setAudioEnabled(false);
  try {
    await session.start(startOptions);
    const handle = session.generateReply({
      instructions:
        "Speak the following mandatory AI disclosure and greeting verbatim, in its original " +
        `language. Do not add, omit, or paraphrase anything: ${JSON.stringify(disclosureAndGreeting)}`,
      allowInterruptions: true,
    });
    await handle.waitForPlayout();
  } finally {
    session.input.setAudioEnabled(true);
  }
}
