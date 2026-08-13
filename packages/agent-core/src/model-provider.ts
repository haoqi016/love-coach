import type { ConversationInput, GuidanceOutput, RiskAssessment } from '@alc/contracts';

export type GuidanceRunAbortCode = 'external_abort' | 'overall_timeout';

export class GuidanceRunAbortedError extends Error {
  public readonly code: GuidanceRunAbortCode;

  public constructor(code: GuidanceRunAbortCode) {
    super(
      code === 'external_abort'
        ? 'Guidance generation was aborted by the caller.'
        : 'Guidance provider chain exceeded its overall timeout.'
    );
    this.name = 'GuidanceRunAbortedError';
    this.code = code;
  }
}

export function guidanceAbortErrorFromSignal(
  signal: AbortSignal
): GuidanceRunAbortedError {
  return signal.reason instanceof GuidanceRunAbortedError
    ? signal.reason
    : new GuidanceRunAbortedError('external_abort');
}

export function throwIfGuidanceAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw guidanceAbortErrorFromSignal(signal);
  }
}

export async function raceWithGuidanceSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: (error: GuidanceRunAbortedError) => void
): Promise<T> {
  if (signal === undefined) {
    return operation;
  }
  if (signal.aborted) {
    const error = guidanceAbortErrorFromSignal(signal);
    onAbort?.(error);
    throw error;
  }

  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      const error = guidanceAbortErrorFromSignal(signal);
      onAbort?.(error);
      reject(error);
    };
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abortListener !== undefined) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

export interface ModelProviderContext {
  readonly safety: RiskAssessment;
  /** Effective request signal, including any caller cancellation or overall deadline. */
  readonly signal?: AbortSignal;
}

/**
 * An adapter boundary for a real model. Implementations must return the shared
 * contract; guideNextConversation validates it again before exposing it.
 */
export interface ModelProvider {
  readonly name: string;
  /** Non-sensitive identifier for the prompt contract used by this provider. */
  readonly promptVersion?: string;
  generateGuidance(
    input: ConversationInput,
    context: ModelProviderContext
  ): Promise<GuidanceOutput>;
}

export type GuidanceSource = 'remote' | 'local_fallback' | 'local_safety' | 'local';

export interface GuidanceProvenance {
  readonly source: GuidanceSource;
  /** Provider that produced the returned guidance, never a credential or raw prompt. */
  readonly provider?: string;
  readonly promptVersion?: string;
}

export interface GuidanceRunResult {
  readonly guidance: GuidanceOutput;
  readonly provenance: GuidanceProvenance;
}

export interface GuideOptions {
  /** Backward-compatible single provider. Do not combine with providers. */
  readonly provider?: ModelProvider;
  /** Providers attempted in order. Do not combine with provider. */
  readonly providers?: readonly ModelProvider[];
  /** Use the deterministic local provider after every configured provider fails. */
  readonly fallbackToLocal?: boolean;
  /** Caller-owned cancellation. Aborting it never starts another Provider or local fallback. */
  readonly signal?: AbortSignal;
  /** Total remote Provider-chain budget. Timeout may use local fallback when enabled. */
  readonly overallTimeoutMs?: number;
}
