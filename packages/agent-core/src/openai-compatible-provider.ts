import {
  GuidanceOutputSchema,
  type ConversationInput,
  type GuidanceOutput
} from '@alc/contracts';

import {
  GUIDANCE_PROMPT_VERSION,
  GUIDANCE_SYSTEM_PROMPT,
  guidanceUserContent
} from './guidance-prompt.js';
import { parseGuidanceJsonContent } from './guidance-json.js';
import {
  GuidanceRunAbortedError,
  guidanceAbortErrorFromSignal,
  raceWithGuidanceSignal,
  throwIfGuidanceAborted,
  type ModelProvider,
  type ModelProviderContext
} from './model-provider.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_PREFIX = 'openai-compatible';

type FetchImplementation = typeof globalThis.fetch;

export type OpenAiCompatibleParams = Readonly<Record<string, unknown>>;

export type OpenAiCompatibleErrorCode =
  | 'invalid_configuration'
  | 'request_timeout'
  | 'network_error'
  | 'authentication_error'
  | 'rate_limited'
  | 'upstream_error'
  | 'upstream_http_error'
  | 'invalid_response'
  | 'invalid_json'
  | 'schema_validation_failed';

export interface OpenAiCompatibleProviderOptions {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Non-sensitive label shown in provenance. Defaults to openai-compatible:<model>. */
  readonly providerName?: string;
  readonly timeoutMs?: number;
  readonly params?: OpenAiCompatibleParams;
  /** Injectable for deterministic tests; defaults to the runtime fetch. */
  readonly fetch?: FetchImplementation;
}

interface OpenAiCompatibleErrorOptions {
  readonly status?: number;
  readonly cause?: unknown;
}

export class OpenAiCompatibleError extends Error {
  public readonly code: OpenAiCompatibleErrorCode;
  public readonly status: number | undefined;

  public constructor(
    code: OpenAiCompatibleErrorCode,
    message: string,
    options: OpenAiCompatibleErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'OpenAiCompatibleError';
    this.code = code;
    this.status = options.status;
  }
}

interface CompletedHttpResponse {
  readonly response: Response;
  readonly body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      `OpenAI-compatible configuration requires ${field}.`
    );
  }
  return trimmed;
}

function requestCredential(value: string): string {
  const apiKey = requiredText(value, 'apiKey');
  if (/\r|\n/u.test(apiKey)) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      'OpenAI-compatible apiKey must not contain line breaks.'
    );
  }
  return apiKey;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function safeProviderName(value: string): string {
  const providerName = requiredText(value, 'providerName');
  if (providerName.length > 160 || containsControlCharacter(providerName)) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      'OpenAI-compatible providerName must be a short printable label.'
    );
  }
  return providerName;
}

function endpointFor(apiBaseUrl: string): string {
  const base = requiredText(apiBaseUrl, 'apiBaseUrl');
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch (cause: unknown) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      'OpenAI-compatible apiBaseUrl must be a valid HTTPS URL.',
      { cause }
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      'OpenAI-compatible apiBaseUrl must use HTTPS.'
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      'OpenAI-compatible apiBaseUrl must not include credentials.'
    );
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      'OpenAI-compatible apiBaseUrl must not include a query or fragment.'
    );
  }

  const basePath = parsed.pathname.replace(/\/+$/u, '');
  if (basePath.endsWith('/v1/chat/completions')) {
    parsed.pathname = basePath;
  } else if (basePath.endsWith('/v1')) {
    parsed.pathname = `${basePath}/chat/completions`;
  } else {
    parsed.pathname = `${basePath}/v1/chat/completions`;
  }
  return parsed.toString();
}

function timeoutFor(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new OpenAiCompatibleError(
      'invalid_configuration',
      `OpenAI-compatible timeoutMs must be between 1 and ${DEFAULT_TIMEOUT_MS}.`
    );
  }
  return timeoutMs;
}

function assistantContent(envelope: unknown): string {
  if (!isRecord(envelope) || !Array.isArray(envelope.choices)) {
    throw new OpenAiCompatibleError(
      'invalid_response',
      'OpenAI-compatible endpoint returned an invalid chat-completion response.'
    );
  }

  const firstChoice = envelope.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new OpenAiCompatibleError(
      'invalid_response',
      'OpenAI-compatible endpoint returned no assistant message.'
    );
  }

  const content = firstChoice.message.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new OpenAiCompatibleError(
      'invalid_response',
      'OpenAI-compatible endpoint returned empty assistant content.'
    );
  }
  return content;
}

function parseResponseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (cause: unknown) {
    throw new OpenAiCompatibleError(
      'invalid_response',
      'OpenAI-compatible endpoint returned a non-JSON chat-completion response.',
      { cause }
    );
  }
}

function parseGuidance(content: string): GuidanceOutput {
  let parsed: unknown;
  try {
    parsed = parseGuidanceJsonContent(content);
  } catch (cause: unknown) {
    throw new OpenAiCompatibleError(
      'invalid_json',
      'OpenAI-compatible endpoint returned malformed guidance JSON.',
      { cause }
    );
  }

  const validated = GuidanceOutputSchema.safeParse(parsed);
  if (!validated.success) {
    throw new OpenAiCompatibleError(
      'schema_validation_failed',
      'OpenAI-compatible endpoint returned JSON that does not match the guidance contract.',
      { cause: validated.error }
    );
  }
  return validated.data;
}

export class OpenAiCompatibleProvider implements ModelProvider {
  public readonly name: string;
  public readonly promptVersion = GUIDANCE_PROMPT_VERSION;

  private readonly endpoint: string;
  readonly #apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly params: OpenAiCompatibleParams;
  private readonly fetchImplementation: FetchImplementation;

  public constructor(options: OpenAiCompatibleProviderOptions) {
    this.endpoint = endpointFor(options.apiBaseUrl);
    this.#apiKey = requestCredential(options.apiKey);
    this.model = requiredText(options.model, 'model');
    this.timeoutMs = timeoutFor(options.timeoutMs);
    this.params = {
      temperature: 0.2,
      max_tokens: 1_800,
      ...options.params
    };
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.name = safeProviderName(
      options.providerName ?? `${DEFAULT_PROVIDER_PREFIX}:${this.model}`
    );
  }

  public async generateGuidance(
    input: ConversationInput,
    context: ModelProviderContext
  ): Promise<GuidanceOutput> {
    throwIfGuidanceAborted(context.signal);
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const httpRequest = Promise.resolve()
      .then(() =>
        this.fetchImplementation(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...this.params,
            model: this.model,
            messages: [
              { role: 'system', content: GUIDANCE_SYSTEM_PROMPT },
              {
                role: 'user',
                content: guidanceUserContent(input, context.safety)
              }
            ],
            stream: false
          }),
          signal: controller.signal
        })
      )
      .then(async (response): Promise<CompletedHttpResponse> => ({
        response,
        body: await response.text()
      }));
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        const error = new OpenAiCompatibleError(
          'request_timeout',
          `OpenAI-compatible request timed out after ${this.timeoutMs}ms.`
        );
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });

    let completed: CompletedHttpResponse;
    try {
      completed = await raceWithGuidanceSignal(
        Promise.race([httpRequest, timeout]),
        context.signal,
        (error) => {
          controller.abort(error);
        }
      );
    } catch (cause: unknown) {
      if (cause instanceof GuidanceRunAbortedError) {
        throw cause;
      }
      if (context.signal?.aborted) {
        throw guidanceAbortErrorFromSignal(context.signal);
      }
      if (cause instanceof OpenAiCompatibleError) {
        throw cause;
      }
      if (controller.signal.aborted) {
        if (controller.signal.reason instanceof OpenAiCompatibleError) {
          throw controller.signal.reason;
        }
        throw new OpenAiCompatibleError(
          'request_timeout',
          `OpenAI-compatible request timed out after ${this.timeoutMs}ms.`,
          { cause }
        );
      }
      throw new OpenAiCompatibleError(
        'network_error',
        'OpenAI-compatible request failed.',
        { cause }
      );
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    if (!completed.response.ok) {
      const status = completed.response.status;
      if (status === 401 || status === 403) {
        throw new OpenAiCompatibleError(
          'authentication_error',
          `OpenAI-compatible authentication failed with HTTP ${status}.`,
          { status }
        );
      }
      if (status === 429) {
        throw new OpenAiCompatibleError(
          'rate_limited',
          'OpenAI-compatible rate limit was exceeded.',
          { status }
        );
      }
      if (status >= 500) {
        throw new OpenAiCompatibleError(
          'upstream_error',
          `OpenAI-compatible upstream failed with HTTP ${status}.`,
          { status }
        );
      }
      throw new OpenAiCompatibleError(
        'upstream_http_error',
        `OpenAI-compatible request failed with HTTP ${status}.`,
        { status }
      );
    }

    const envelope = parseResponseBody(completed.body);
    return parseGuidance(assistantContent(envelope));
  }
}
