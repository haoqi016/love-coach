import { z } from 'zod';

import type { RealtimeVoiceServerConfig } from '../config.js';

const ClientSecretResponseSchema = z
  .object({
    value: z.string().regex(/^ek_[A-Za-z0-9_-]{8,4093}$/u),
    expires_at: z.number().int().positive()
  })
  .passthrough();

const REALTIME_REQUEST_TIMEOUT_MS = 10_000;
const CLIENT_SECRET_LIFETIME_SECONDS = 10;
const CLIENT_SECRET_EXPIRY_TOLERANCE_SECONDS = 5;

export class RealtimeClientError extends Error {
  public constructor(
    public readonly reason: 'aborted' | 'timeout' | 'upstream_unavailable' | 'invalid_response'
  ) {
    super('The realtime voice service is temporarily unavailable.');
    this.name = 'RealtimeClientError';
  }
}

export interface CreateRealtimeClientSecretOptions {
  readonly instructions: string;
  readonly safetyIdentifier: string;
  readonly signal?: AbortSignal;
}

export interface RealtimeClientSecret {
  readonly value: string;
  readonly expiresAt: number;
}

export class OpenAiRealtimeClient {
  readonly #config: RealtimeVoiceServerConfig;
  readonly #fetch: typeof fetch;
  readonly #timeoutMilliseconds: number;
  readonly #now: () => number;

  public constructor(
    config: RealtimeVoiceServerConfig,
    options: {
      readonly fetch?: typeof fetch;
      readonly timeoutMilliseconds?: number;
      readonly now?: () => number;
    } = {}
  ) {
    this.#config = config;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? REALTIME_REQUEST_TIMEOUT_MS;
    this.#now = options.now ?? Date.now;
  }

  public async createClientSecret(
    options: CreateRealtimeClientSecretOptions
  ): Promise<RealtimeClientSecret> {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    if (options.signal?.aborted) abortFromCaller();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Realtime request timed out.', 'TimeoutError'));
    }, this.#timeoutMilliseconds);

    try {
      if (controller.signal.aborted) {
        throw new RealtimeClientError(timedOut ? 'timeout' : 'aborted');
      }
      const response = await this.#fetch(
        `${this.#config.apiBaseUrl}/realtime/client_secrets`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#config.apiKey}`,
            'Content-Type': 'application/json',
            'OpenAI-Safety-Identifier': options.safetyIdentifier
          },
          body: JSON.stringify({
            expires_after: {
              anchor: 'created_at',
              seconds: CLIENT_SECRET_LIFETIME_SECONDS
            },
            session: {
              type: 'realtime',
              model: this.#config.model,
              instructions: options.instructions,
              output_modalities: ['audio'],
              max_output_tokens: 512,
              audio: {
                input: {
                  transcription: {
                    model: this.#config.transcriptionModel,
                    language: 'zh',
                    prompt: '中文恋爱沟通复盘；保留口语语气，不补写人名或事实。'
                  },
                  turn_detection: {
                    type: 'semantic_vad',
                    create_response: false,
                    eagerness: 'low',
                    interrupt_response: false
                  }
                },
                output: {
                  voice: this.#config.voice
                }
              }
            }
          }),
          signal: controller.signal
        }
      );
      if (controller.signal.aborted) {
        throw new RealtimeClientError(timedOut ? 'timeout' : 'aborted');
      }
      if (!response.ok) throw new RealtimeClientError('upstream_unavailable');

      let candidate: unknown;
      try {
        candidate = await response.json();
      } catch {
        throw new RealtimeClientError('invalid_response');
      }
      if (controller.signal.aborted) {
        throw new RealtimeClientError(timedOut ? 'timeout' : 'aborted');
      }
      const parsed = ClientSecretResponseSchema.safeParse(candidate);
      if (!parsed.success) throw new RealtimeClientError('invalid_response');
      const nowSeconds = Math.floor(this.#now() / 1_000);
      if (
        parsed.data.expires_at <= nowSeconds ||
        parsed.data.expires_at >
          nowSeconds +
            CLIENT_SECRET_LIFETIME_SECONDS +
            CLIENT_SECRET_EXPIRY_TOLERANCE_SECONDS
      ) {
        throw new RealtimeClientError('invalid_response');
      }
      return { value: parsed.data.value, expiresAt: parsed.data.expires_at };
    } catch (error: unknown) {
      if (error instanceof RealtimeClientError) throw error;
      if (controller.signal.aborted) {
        throw new RealtimeClientError(timedOut ? 'timeout' : 'aborted');
      }
      throw new RealtimeClientError('upstream_unavailable');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
