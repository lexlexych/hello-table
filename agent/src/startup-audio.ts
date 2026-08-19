import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { AudioFrame } from "@livekit/rtc-node";

const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const SAMPLES_PER_FRAME = SAMPLE_RATE / 100;
const UNKNOWN_CHUNK_SIZE = 0xffff_ffff;

function invalidWav(path: string, reason: string): Error {
  return new Error(`Invalid prerecorded WAV ${path}: ${reason}`);
}

/** Reads the project's fixed PCM WAV format without introducing an FFmpeg runtime dependency. */
async function readPcmWav(path: string): Promise<AudioFrame[]> {
  const file = await readFile(path);
  if (
    file.length < 12 ||
    file.toString("ascii", 0, 4) !== "RIFF" ||
    file.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw invalidWav(path, "expected a RIFF/WAVE header");
  }

  let formatFound = false;
  let data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= file.length; ) {
    const chunkId = file.toString("ascii", offset, offset + 4);
    const chunkSize = file.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const hasUnknownSize = chunkSize === UNKNOWN_CHUNK_SIZE;
    if (hasUnknownSize && chunkId !== "data") {
      throw invalidWav(path, `${chunkId} chunk has an unknown size`);
    }
    // Streaming WAV writers cannot seek back to fill the final data size and use
    // 0xFFFFFFFF as a sentinel. In that representation PCM occupies the rest of the file.
    const chunkEnd = hasUnknownSize ? file.length : chunkStart + chunkSize;
    if (chunkEnd > file.length) {
      throw invalidWav(path, `truncated ${chunkId} chunk`);
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw invalidWav(path, "fmt chunk is too short");
      }
      const audioFormat = file.readUInt16LE(chunkStart);
      const channels = file.readUInt16LE(chunkStart + 2);
      const sampleRate = file.readUInt32LE(chunkStart + 4);
      const bitsPerSample = file.readUInt16LE(chunkStart + 14);
      if (
        audioFormat !== 1 ||
        channels !== CHANNELS ||
        sampleRate !== SAMPLE_RATE ||
        bitsPerSample !== BITS_PER_SAMPLE
      ) {
        throw invalidWav(
          path,
          `expected PCM ${BITS_PER_SAMPLE}-bit, ${SAMPLE_RATE} Hz, mono`,
        );
      }
      formatFound = true;
    } else if (chunkId === "data") {
      data = file.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (hasUnknownSize ? 0 : chunkSize % 2);
  }

  if (!formatFound) {
    throw invalidWav(path, "fmt chunk is missing");
  }
  if (data === undefined || data.length === 0) {
    throw invalidWav(path, "data chunk is missing or empty");
  }
  if (data.length % 2 !== 0) {
    throw invalidWav(path, "PCM data length is not aligned to 16-bit samples");
  }

  const frames: AudioFrame[] = [];
  const totalSamples = data.length / 2;
  for (let start = 0; start < totalSamples; start += SAMPLES_PER_FRAME) {
    const sampleCount = Math.min(SAMPLES_PER_FRAME, totalSamples - start);
    const samples = new Int16Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = data.readInt16LE((start + index) * 2);
    }
    frames.push(new AudioFrame(samples, SAMPLE_RATE, CHANNELS, sampleCount));
  }
  return frames;
}

/** Loads the mandatory Russian disclosure followed by the Russian greeting. */
export async function loadRussianStartupAudio(): Promise<
  readonly AudioFrame[]
> {
  const paths = [
    fileURLToPath(new URL("../audio/ru/ai_disclosure.wav", import.meta.url)),
    fileURLToPath(new URL("../audio/ru/greeting.wav", import.meta.url)),
  ];
  const files = await Promise.all(paths.map((path) => readPcmWav(path)));
  return files.flat();
}

/**
 * Discovers filler1.wav, filler2.wav, ... and loads them in numeric order.
 * Gaps are allowed, so adding or removing a clip never requires a TypeScript change.
 */
export async function loadRussianTurnFillers(): Promise<
  readonly (readonly AudioFrame[])[]
> {
  const directory = fileURLToPath(new URL("../audio/ru/", import.meta.url));
  const entries = await readdir(directory, { withFileTypes: true });
  const numberedFiles = entries
    .filter((entry) => entry.isFile())
    .flatMap((entry) => {
      const match = /^filler([1-9]\d*)\.wav$/.exec(entry.name);
      return match === null
        ? []
        : [{ name: entry.name, number: Number(match[1]) }];
    })
    .sort((left, right) => left.number - right.number);

  if (numberedFiles.length === 0) {
    throw new Error(`No turn filler WAV files found in ${directory}`);
  }
  for (let index = 1; index < numberedFiles.length; index += 1) {
    if (numberedFiles[index]?.number === numberedFiles[index - 1]?.number) {
      throw new Error(
        `Duplicate turn filler number ${numberedFiles[index]?.number} in ${directory}`,
      );
    }
  }

  return Promise.all(
    numberedFiles.map(({ name }) => readPcmWav(join(directory, name))),
  );
}

/** Creates the one-use stream expected by AgentSession.say(). */
export function streamAudioFrames(
  frames: readonly AudioFrame[],
): ReadableStream<AudioFrame> {
  return new ReadableStream<AudioFrame>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(frame);
      }
      controller.close();
    },
  });
}
