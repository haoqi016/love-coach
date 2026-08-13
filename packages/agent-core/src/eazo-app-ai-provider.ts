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

export { GUIDANCE_PROMPT_VERSION } from './guidance-prompt.js';

type FetchImplementation = typeof globalThis.fetch;

export type EazoAppAiParams = Readonly<Record<string, unknown>>;

export type EazoAppAiErrorCode =
  | 'invalid_configuration'
  | 'request_timeout'
  | 'network_error'
  | 'app_ai_unavailable'
  | 'authentication_error'
  | 'rate_limited'
  | 'request_budget_exceeded'
  | 'upstream_error'
  | 'upstream_http_error'
  | 'invalid_response'
  | 'invalid_json'
  | 'schema_validation_failed';

export interface EazoAppAiClientOptions {
  readonly apiBaseUrl: string;
  readonly appId: string;
  readonly privateKey: string;
  readonly timeoutMs?: number;
  /** Injectable for deterministic tests; defaults to the runtime fetch. */
  readonly fetch?: FetchImplementation;
}

export interface EazoAppAiTextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface EazoAppAiImageUrlContentPart {
  readonly type: 'image_url';
  readonly image_url: {
    readonly url: string;
  };
}

export type EazoAppAiContentPart =
  | EazoAppAiTextContentPart
  | EazoAppAiImageUrlContentPart;

export interface EazoAppAiMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly EazoAppAiContentPart[];
}

export interface EazoAppAiChatRequest {
  readonly modelKey: string;
  readonly messages: readonly EazoAppAiMessage[];
  readonly params?: EazoAppAiParams;
  readonly viewerUserId?: string;
  readonly signal?: AbortSignal;
}

export interface EazoAppAiProviderOptions extends EazoAppAiClientOptions {
  readonly modelKey: string;
  /** Model generation parameters passed through by the App AI proxy. */
  readonly params?: EazoAppAiParams;
}

interface EazoAppAiErrorOptions {
  readonly status?: number;
  readonly cause?: unknown;
}

export class EazoAppAiError extends Error {
  public readonly code: EazoAppAiErrorCode;
  public readonly status: number | undefined;

  public constructor(
    code: EazoAppAiErrorCode,
    message: string,
    options: EazoAppAiErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EazoAppAiError';
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
    throw new EazoAppAiError(
      'invalid_configuration',
      `Eazo App AI configuration requires ${field}.`
    );
  }
  return trimmed;
}

function endpointFor(apiBaseUrl: string): string {
  const base = requiredText(apiBaseUrl, 'apiBaseUrl');
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch (cause: unknown) {
    throw new EazoAppAiError(
      'invalid_configuration',
      'Eazo App AI apiBaseUrl must be a valid HTTP(S) URL.',
      { cause }
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new EazoAppAiError(
      'invalid_configuration',
      'Eazo App AI apiBaseUrl must use HTTPS.'
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new EazoAppAiError(
      'invalid_configuration',
      'Eazo App AI apiBaseUrl must not include credentials.'
    );
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new EazoAppAiError(
      'invalid_configuration',
      'Eazo App AI apiBaseUrl must not include a query or fragment.'
    );
  }

  const basePath = parsed.pathname.replace(/\/+$/u, '');
  parsed.pathname = basePath.endsWith('/api/app-ai/chat')
    ? basePath
    : `${basePath}/api/app-ai/chat`;
  return parsed.toString();
}

function timeoutFor(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > DEFAULT_TIMEOUT_MS) {
    throw new EazoAppAiError(
      'invalid_configuration',
      `Eazo App AI timeoutMs must be between 1 and ${DEFAULT_TIMEOUT_MS}.`
    );
  }
  return timeoutMs;
}

function parseJson(value: string, code: EazoAppAiErrorCode, message: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (cause: unknown) {
    throw new EazoAppAiError(code, message, { cause });
  }
}

function upstreamErrorCode(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }
  if (typeof parsed.code === 'string') {
    return parsed.code;
  }

  const detail = parsed.detail;
  if (isRecord(detail) && typeof detail.code === 'string') {
    return detail.code;
  }

  const error = parsed.error;
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function assistantContent(envelope: unknown): string {
  if (!isRecord(envelope) || !Array.isArray(envelope.choices)) {
    throw new EazoAppAiError(
      'invalid_response',
      'Eazo App AI returned an invalid chat-completion response.'
    );
  }

  const firstChoice = envelope.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new EazoAppAiError(
      'invalid_response',
      'Eazo App AI returned no assistant message.'
    );
  }

  const content = firstChoice.message.content;
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (text.length > 0) {
      return text;
    }
  }

  throw new EazoAppAiError(
    'invalid_response',
    'Eazo App AI returned empty assistant content.'
  );
}

export class EazoAppAiClient {
  private readonly endpoint: string;
  readonly #appId: string;
  readonly #privateKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;

  public constructor(options: EazoAppAiClientOptions) {
    this.endpoint = endpointFor(options.apiBaseUrl);
    this.#appId = requiredText(options.appId, 'appId');
    this.#privateKey = requiredText(options.privateKey, 'privateKey');
    this.timeoutMs = timeoutFor(options.timeoutMs);
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  public async chat(request: EazoAppAiChatRequest): Promise<string> {
    const modelKey = requiredText(request.modelKey, 'modelKey');
    if (request.messages.length === 0) {
      throw new EazoAppAiError(
        'invalid_configuration',
        'Eazo App AI chat requires at least one message.'
      );
    }
    throwIfGuidanceAborted(request.signal);

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const viewerUserId =
      request.viewerUserId === undefined
        ? undefined
        : requiredText(request.viewerUserId, 'viewerUserId');

    const httpRequest = Promise.resolve()
      .then(() =>
        this.fetchImplementation(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#privateKey}`,
            'Content-Type': 'application/json',
            'x-eazo-app-id': this.#appId
          },
          body: JSON.stringify({
            app_id: this.#appId,
            model_key: modelKey,
            messages: request.messages,
            ...(viewerUserId === undefined ? {} : { viewer_user_id: viewerUserId }),
            stream: false,
            params: request.params ?? {}
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
        const error = new EazoAppAiError(
          'request_timeout',
          `Eazo App AI request timed out after ${this.timeoutMs}ms.`
        );
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
    });

    let completed: CompletedHttpResponse;
    try {
      completed = await raceWithGuidanceSignal(
        Promise.race([httpRequest, timeout]),
        request.signal,
        (error) => {
          controller.abort(error);
        }
      );
    } catch (cause: unknown) {
      if (cause instanceof GuidanceRunAbortedError) {
        throw cause;
      }
      if (request.signal?.aborted) {
        throw guidanceAbortErrorFromSignal(request.signal);
      }
      if (cause instanceof EazoAppAiError) {
        throw cause;
      }
      if (controller.signal.aborted) {
        if (controller.signal.reason instanceof EazoAppAiError) {
          throw controller.signal.reason;
        }
        throw new EazoAppAiError(
          'request_timeout',
          `Eazo App AI request timed out after ${this.timeoutMs}ms.`,
          { cause }
        );
      }
      throw new EazoAppAiError('network_error', 'Eazo App AI request failed.', { cause });
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    if (!completed.response.ok) {
      const providerCode = upstreamErrorCode(completed.body);
      if (
        completed.response.status === 402 &&
        providerCode === 'app_ai_unavailable'
      ) {
        throw new EazoAppAiError(
          'app_ai_unavailable',
          'Eazo App AI is unavailable because its billing capability or balance is not available.',
          { status: completed.response.status }
        );
      }
      if (completed.response.status === 401 || completed.response.status === 403) {
        throw new EazoAppAiError(
          'authentication_error',
          `Eazo App AI authentication failed with HTTP ${completed.response.status}.`,
          { status: completed.response.status }
        );
      }
      if (completed.response.status === 429) {
        throw new EazoAppAiError(
          'rate_limited',
          'Eazo App AI rate limit was exceeded.',
          { status: completed.response.status }
        );
      }
      if (completed.response.status >= 500) {
        throw new EazoAppAiError(
          'upstream_error',
          `Eazo App AI upstream failed with HTTP ${completed.response.status}.`,
          { status: completed.response.status }
        );
      }
      throw new EazoAppAiError(
        'upstream_http_error',
        `Eazo App AI request failed with HTTP ${completed.response.status}.`,
        { status: completed.response.status }
      );
    }

    const envelope = parseJson(
      completed.body,
      'invalid_response',
      'Eazo App AI returned a non-JSON chat-completion response.'
    );
    return assistantContent(envelope);
  }
}

export class EazoAppAiProvider implements ModelProvider {
  public readonly name: string;
  public readonly promptVersion = GUIDANCE_PROMPT_VERSION;

  private readonly client: EazoAppAiClient;
  private readonly modelKey: string;
  private readonly params: EazoAppAiParams;

  public constructor(options: EazoAppAiProviderOptions) {
    this.client = new EazoAppAiClient(options);
    this.modelKey = requiredText(options.modelKey, 'modelKey');
    this.params = {
      temperature: 0.2,
      max_tokens: 1_800,
      ...options.params
    };
    this.name = `eazo-app-ai:${this.modelKey}`;
  }

  public async generateGuidance(
    input: ConversationInput,
    context: ModelProviderContext
  ): Promise<GuidanceOutput> {
    const content = await this.client.chat({
      modelKey: this.modelKey,
      messages: [
        { role: 'system', content: GUIDANCE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: guidanceUserContent(input, context.safety)
        }
      ],
      params: this.params,
      ...(context.signal === undefined ? {} : { signal: context.signal })
    });
    let parsedGuidance: unknown;
    try {
      parsedGuidance = parseGuidanceJsonContent(content);
    } catch (cause: unknown) {
      throw new EazoAppAiError(
        'invalid_json',
        'Eazo App AI returned malformed JSON content.',
        { cause }
      );
    }
    const validated = GuidanceOutputSchema.safeParse(parsedGuidance);
    if (!validated.success) {
      throw new EazoAppAiError(
        'schema_validation_failed',
        'Eazo App AI returned JSON that does not match the guidance contract.',
        { cause: validated.error }
      );
    }
    return validated.data;
  }
}
