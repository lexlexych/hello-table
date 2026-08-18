import { randomUUID } from "node:crypto";
import {
  APIConnectionError,
  type APIConnectOptions,
  APIError,
  APIStatusError,
  AudioByteStream,
  tts,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";

const OPENAI_TTS_SAMPLE_RATE = 24_000;
const OPENAI_TTS_CHANNELS = 1;
const AUDIO_FRAME_DURATION_MS = 20;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIStreamingTTSOptions {
  apiKey: string;
  baseURL?: string;
  model: string;
  voice: string;
}

/**
 * OpenAI Speech API adapter that forwards PCM bytes to LiveKit as they arrive.
 *
 * `streaming: false` describes the provider's text-input contract: Speech API still needs a
 * complete phrase. LiveKit therefore keeps splitting streamed LLM output into sentences, while
 * each sentence's HTTP audio response is emitted incrementally by {@link StreamingChunkedStream}.
 */
export class OpenAIStreamingTTS extends tts.TTS {
  label = "openai.StreamingTTS";
  readonly #apiKey: string;
  readonly #baseURL: string;
  readonly #abortController = new AbortController();
  #model: string;
  #voice: string;

  constructor(options: OpenAIStreamingTTSOptions) {
    super(OPENAI_TTS_SAMPLE_RATE, OPENAI_TTS_CHANNELS, {
      streaming: false,
    });
    this.#apiKey = options.apiKey;
    this.#baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#model = options.model;
    this.#voice = options.voice;
  }

  get model(): string {
    return this.#model;
  }

  get provider(): string {
    return new URL(this.#baseURL).host;
  }

  updateOptions(options: { model?: string; voice?: string }): void {
    this.#model = options.model ?? this.#model;
    this.#voice = options.voice ?? this.#voice;
  }

  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ): StreamingChunkedStream {
    const signal = abortSignal
      ? AbortSignal.any([abortSignal, this.#abortController.signal])
      : this.#abortController.signal;

    return new StreamingChunkedStream(
      this,
      text,
      {
        apiKey: this.#apiKey,
        endpoint: `${this.#baseURL}/audio/speech`,
        model: this.#model,
        voice: this.#voice,
      },
      connOptions,
      signal,
    );
  }

  stream(): tts.SynthesizeStream {
    throw new Error("OpenAI Speech API requires a complete text phrase");
  }

  async close(): Promise<void> {
    this.#abortController.abort();
  }
}

interface StreamingRequest {
  apiKey: string;
  endpoint: string;
  model: string;
  voice: string;
}

class StreamingChunkedStream extends tts.ChunkedStream {
  label = "openai.StreamingChunkedStream";
  readonly #request: StreamingRequest;

  constructor(
    provider: OpenAIStreamingTTS,
    text: string,
    request: StreamingRequest,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, provider, connOptions, abortSignal);
    this.#request = request;
  }

  protected async run(): Promise<void> {
    try {
      const response = await this.#fetchSpeech();
      const reader = response.body?.getReader();
      if (reader === undefined) {
        throw new APIConnectionError({
          message: "OpenAI Speech API returned an empty response body",
        });
      }

      const requestId = response.headers.get("x-request-id") ?? randomUUID();
      const audio = new AudioByteStream(
        OPENAI_TTS_SAMPLE_RATE,
        OPENAI_TTS_CHANNELS,
        (OPENAI_TTS_SAMPLE_RATE * AUDIO_FRAME_DURATION_MS) / 1_000,
      );
      let lastFrame: AudioFrame | undefined;

      const enqueue = (frames: AudioFrame[]): void => {
        for (const frame of frames) {
          if (lastFrame !== undefined) {
            this.queue.put({
              requestId,
              segmentId: requestId,
              frame: lastFrame,
              final: false,
            });
          }
          lastFrame = frame;
        }
      };

      try {
        while (!this.abortSignal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          enqueue(audio.write(value));
        }
        enqueue(audio.flush());
      } finally {
        reader.releaseLock();
      }

      if (lastFrame === undefined && !this.abortSignal.aborted) {
        throw new APIError("OpenAI Speech API returned no PCM audio");
      }
      if (lastFrame !== undefined && !this.abortSignal.aborted) {
        this.queue.put({
          requestId,
          segmentId: requestId,
          frame: lastFrame,
          final: true,
        });
      }
    } catch (error) {
      if (this.abortSignal.aborted || isAbortError(error)) {
        return;
      }
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIConnectionError({
        message: "OpenAI Speech API connection failed",
      });
    } finally {
      this.queue.close();
    }
  }

  async #fetchSpeech(): Promise<Response> {
    const response = await fetch(this.#request.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#request.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: this.inputText,
        model: this.#request.model,
        voice: this.#request.voice,
        response_format: "pcm",
      }),
      signal: this.abortSignal,
    });

    if (!response.ok) {
      throw new APIStatusError({
        message: "OpenAI Speech API request failed",
        options: {
          statusCode: response.status,
          requestId: response.headers.get("x-request-id"),
        },
      });
    }
    return response;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
