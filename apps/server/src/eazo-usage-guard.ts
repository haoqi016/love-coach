const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface RemoteUsageGuardOptions {
  readonly maxRequestsPerMinute: number;
  readonly maxConcurrentRequests: number;
  readonly maxModelRequestsPerDay: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

export type RemotePublicRequestPermit =
  | { readonly allowed: true; readonly release: () => void }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * A process-local safety valve for a single-container competition deployment.
 * It intentionally does not claim to be a distributed billing ledger.
 */
export class RemoteUsageLimitError extends Error {
  public readonly code: 'rate_limited' | 'request_budget_exceeded';
  public readonly status: number | undefined;

  public constructor(
    code: 'rate_limited' | 'request_budget_exceeded',
    message: string,
    status?: number
  ) {
    super(message);
    this.name = 'RemoteUsageLimitError';
    this.code = code;
    this.status = status;
  }
}

export class RemoteUsageGuard {
  public readonly guardedFetch: typeof globalThis.fetch;

  private readonly maxRequestsPerMinute: number;
  private readonly maxConcurrentRequests: number;
  private readonly maxModelRequestsPerDay: number;
  private readonly now: () => number;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private minuteWindowStartedAt: number;
  private dayWindowStartedAt: number;
  private requestCount = 0;
  private activeRequestCount = 0;
  private modelRequestCount = 0;

  public constructor(options: RemoteUsageGuardOptions) {
    this.maxRequestsPerMinute = options.maxRequestsPerMinute;
    this.maxConcurrentRequests = options.maxConcurrentRequests;
    this.maxModelRequestsPerDay = options.maxModelRequestsPerDay;
    this.now = options.now ?? Date.now;
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
    const startedAt = this.now();
    this.minuteWindowStartedAt = startedAt;
    this.dayWindowStartedAt = startedAt;
    this.guardedFetch = async (input, init) => {
      this.consumeModelRequest();
      return this.fetchImplementation(input, init);
    };
  }

  public beginPublicRequest(): RemotePublicRequestPermit {
    const now = this.now();
    if (now - this.minuteWindowStartedAt >= MINUTE_MS) {
      this.minuteWindowStartedAt = now;
      this.requestCount = 0;
    }

    if (this.activeRequestCount >= this.maxConcurrentRequests) {
      return { allowed: false, retryAfterSeconds: 1 };
    }

    if (this.requestCount >= this.maxRequestsPerMinute) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((this.minuteWindowStartedAt + MINUTE_MS - now) / 1_000)
        )
      };
    }

    this.requestCount += 1;
    this.activeRequestCount += 1;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.activeRequestCount = Math.max(0, this.activeRequestCount - 1);
      }
    };
  }

  private consumeModelRequest(): void {
    const now = this.now();
    if (now - this.dayWindowStartedAt >= DAY_MS) {
      this.dayWindowStartedAt = now;
      this.modelRequestCount = 0;
    }

    if (this.modelRequestCount >= this.maxModelRequestsPerDay) {
      throw new RemoteUsageLimitError(
        'request_budget_exceeded',
        'The local remote-model request budget has been reached.'
      );
    }

    this.modelRequestCount += 1;
  }
}

/** Backward-compatible aliases for existing server imports and tests. */
export type EazoUsageGuardOptions = RemoteUsageGuardOptions;
export type EazoPublicRequestPermit = RemotePublicRequestPermit;
export { RemoteUsageGuard as EazoUsageGuard };
