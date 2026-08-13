import { randomUUID } from 'node:crypto';

import { MAX_VOICE_TURN_TEXT_LENGTH } from '@alc/contracts';

export type VoiceLeaseLimitReason = 'client_active' | 'instance_capacity' | 'daily_budget';

export interface VoiceLease {
  readonly id: string;
  readonly clientId: string;
  readonly expiresAt: number;
}

export type BeginVoiceLeaseResult =
  | { readonly allowed: true; readonly lease: VoiceLease }
  | {
      readonly allowed: false;
      readonly reason: VoiceLeaseLimitReason;
      readonly retryAfterSeconds: number;
    };

export interface VoiceLeaseManagerOptions {
  readonly maxActiveLeases: number;
  readonly maxStartsPerDay: number;
  readonly maxSessionSeconds: number;
  readonly now?: () => number;
  readonly createId?: () => string;
}

interface DailyStartWindow {
  readonly day: string;
  count: number;
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  const nextDay = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((nextDay - timestamp) / 1_000));
}

/**
 * Best-effort, single-process protection for the competition demo. It is not a
 * cross-instance billing control and does not terminate an established WebRTC call.
 */
export class VoiceLeaseManager {
  readonly #activeById = new Map<string, VoiceLease>();
  readonly #activeByClient = new Map<string, string>();
  readonly #approvedTranscriptSuffixById = new Map<string, string>();
  readonly #maxActiveLeases: number;
  readonly #maxStartsPerDay: number;
  readonly #maxSessionMilliseconds: number;
  readonly #now: () => number;
  readonly #createId: () => string;
  #dailyStarts: DailyStartWindow;

  public constructor(options: VoiceLeaseManagerOptions) {
    this.#maxActiveLeases = options.maxActiveLeases;
    this.#maxStartsPerDay = options.maxStartsPerDay;
    this.#maxSessionMilliseconds = options.maxSessionSeconds * 1_000;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
    this.#dailyStarts = { day: utcDay(this.#now()), count: 0 };
  }

  public begin(clientId: string): BeginVoiceLeaseResult {
    const now = this.#now();
    this.#prune(now);
    this.#resetDailyWindow(now);

    const existingId = this.#activeByClient.get(clientId);
    if (existingId) {
      const existing = this.#activeById.get(existingId);
      if (existing) {
        return {
          allowed: false,
          reason: 'client_active',
          retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1_000))
        };
      }
    }

    if (this.#activeById.size >= this.#maxActiveLeases) {
      const soonestExpiry = Math.min(
        ...[...this.#activeById.values()].map((lease) => lease.expiresAt)
      );
      return {
        allowed: false,
        reason: 'instance_capacity',
        retryAfterSeconds: Math.max(1, Math.ceil((soonestExpiry - now) / 1_000))
      };
    }

    if (this.#dailyStarts.count >= this.#maxStartsPerDay) {
      return {
        allowed: false,
        reason: 'daily_budget',
        retryAfterSeconds: secondsUntilNextUtcDay(now)
      };
    }

    const lease: VoiceLease = Object.freeze({
      id: this.#createId(),
      clientId,
      expiresAt: now + this.#maxSessionMilliseconds
    });
    this.#dailyStarts.count += 1;
    this.#activeById.set(lease.id, lease);
    this.#activeByClient.set(clientId, lease.id);
    this.#approvedTranscriptSuffixById.set(lease.id, '');
    return { allowed: true, lease };
  }

  public isActive(leaseId: string, clientId: string): boolean {
    this.#prune(this.#now());
    return this.#activeById.get(leaseId)?.clientId === clientId;
  }

  public approvedTranscriptSuffix(
    leaseId: string,
    clientId: string
  ): string | undefined {
    this.#prune(this.#now());
    if (this.#activeById.get(leaseId)?.clientId !== clientId) return undefined;
    return this.#approvedTranscriptSuffixById.get(leaseId) ?? '';
  }

  public recordApprovedTranscript(
    leaseId: string,
    clientId: string,
    transcript: string
  ): boolean {
    const approvedSuffix = this.approvedTranscriptSuffix(leaseId, clientId);
    if (approvedSuffix === undefined) return false;
    this.#approvedTranscriptSuffixById.set(
      leaseId,
      `${approvedSuffix}${transcript}`.slice(-MAX_VOICE_TURN_TEXT_LENGTH)
    );
    return true;
  }

  public end(leaseId: string, clientId: string): boolean {
    this.#prune(this.#now());
    const lease = this.#activeById.get(leaseId);
    if (!lease || lease.clientId !== clientId) return false;
    this.#delete(lease);
    return true;
  }

  public releaseAfterFailedStart(leaseId: string, clientId: string): void {
    this.end(leaseId, clientId);
  }

  public get activeCount(): number {
    this.#prune(this.#now());
    return this.#activeById.size;
  }

  #prune(now: number): void {
    for (const lease of this.#activeById.values()) {
      if (lease.expiresAt <= now) this.#delete(lease);
    }
  }

  #delete(lease: VoiceLease): void {
    this.#activeById.delete(lease.id);
    this.#approvedTranscriptSuffixById.delete(lease.id);
    if (this.#activeByClient.get(lease.clientId) === lease.id) {
      this.#activeByClient.delete(lease.clientId);
    }
  }

  #resetDailyWindow(now: number): void {
    const day = utcDay(now);
    if (this.#dailyStarts.day !== day) this.#dailyStarts = { day, count: 0 };
  }
}
