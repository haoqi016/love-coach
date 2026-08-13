import type {
  GuidanceRequest,
  VoiceCapabilities,
  VoiceContextToken,
  VoiceEndRequest,
  VoiceRefinementNote,
  VoiceRefinementRequest,
  VoiceSessionRequest,
  VoiceSessionResponse,
  VoiceTurnSafetyRequest,
  VoiceTurnSafetyResponse
} from '@alc/contracts';
import {
  VoiceRefinementRequestSchema,
  VoiceSessionRequestSchema
} from '@alc/contracts';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  checkVoiceTurnSafety,
  createVoiceSession,
  endVoiceSession,
  refineGuidanceWithVoice
} from './voice-api';
import type { VoiceRefinementResponse } from './voice-api';
import {
  createOpenAiRealtimeVoiceController,
  realtimeConnectionOptionsFromSession
} from './realtime-controller';
import type {
  VoiceRealtimeController,
  VoiceRealtimeControllerFactory,
  VoiceRealtimeEvent
} from './realtime-controller';
import { createInitialVoiceState, voiceReducer } from './voice-state';
import type {
  VoiceAction,
  VoicePhase,
  VoiceState,
  VoiceTranscriptTurn
} from './voice-state';

type EnabledVoiceCapabilities = Extract<VoiceCapabilities, { enabled: true }>;

export interface VoiceApiClient {
  createSession(input: VoiceSessionRequest): Promise<VoiceSessionResponse>;
  checkTurnSafety(input: VoiceTurnSafetyRequest): Promise<VoiceTurnSafetyResponse>;
  endSession(input: VoiceEndRequest, options?: { keepalive?: boolean }): Promise<void>;
  refine(
    input: VoiceRefinementRequest,
    options?: { signal?: AbortSignal }
  ): Promise<VoiceRefinementResponse>;
}

const defaultVoiceApiClient: VoiceApiClient = {
  createSession: createVoiceSession,
  checkTurnSafety: checkVoiceTurnSafety,
  endSession: endVoiceSession,
  refine: refineGuidanceWithVoice
};

export interface UseRealtimeVoiceOptions {
  capabilities: EnabledVoiceCapabilities;
  voiceContextToken: VoiceContextToken;
  originalRequest: GuidanceRequest;
  selectedDraft: string;
  controllerFactory?: VoiceRealtimeControllerFactory;
  apiClient?: VoiceApiClient;
  onRefined: (result: VoiceRefinementResponse) => void;
}

export interface RealtimeVoiceControls {
  state: VoiceState;
  start(): Promise<void>;
  retry(): Promise<void>;
  toggleMute(): void;
  interrupt(): void;
  end(): Promise<void>;
  close(): void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function compactVoiceNote(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

const MAX_VOICE_REFINEMENT_NOTES = 8;
const MAX_VOICE_REFINEMENT_NOTE_LENGTH = 240;

export type VoiceFinalizationTrigger = 'manual' | 'timeout' | 'turn_limit';
export type VoiceFinalizationDecision =
  | 'blocked'
  | 'refine'
  | 'reject_context_budget'
  | 'reject_oversized_transcript'
  | 'end_without_refinement';

export interface VoiceRefinementNoteBuildResult {
  notes: VoiceRefinementNote[];
  overflow: boolean;
}

function boundedVoiceNoteEnd(value: string, start: number): number {
  let end = Math.min(start + MAX_VOICE_REFINEMENT_NOTE_LENGTH, value.length);
  const lastCodeUnit = value.charCodeAt(end - 1);
  const nextCodeUnit = value.charCodeAt(end);
  if (
    end < value.length &&
    lastCodeUnit >= 0xd800 &&
    lastCodeUnit <= 0xdbff &&
    nextCodeUnit >= 0xdc00 &&
    nextCodeUnit <= 0xdfff
  ) {
    end -= 1;
  }
  return end;
}

export function buildVoiceRefinementNotes(
  turns: readonly VoiceTranscriptTurn[]
): VoiceRefinementNoteBuildResult {
  const seen = new Set<string>();
  const values: string[] = [];
  const notes: VoiceRefinementNote[] = [];

  for (const turn of turns) {
    if (seen.has(turn.id)) continue;
    seen.add(turn.id);
    const value = compactVoiceNote(turn.transcript);
    if (!value) continue;
    values.push(value);
  }

  const packed = values.join('');
  let offset = 0;
  while (offset < packed.length) {
    if (notes.length >= MAX_VOICE_REFINEMENT_NOTES) {
      return { notes, overflow: true };
    }
    const end = boundedVoiceNoteEnd(packed, offset);
    notes.push({
      kind: 'other',
      value: packed.slice(offset, end),
      confirmed: true
    });
    offset = end;
  }

  return { notes, overflow: false };
}

export function voiceFinalizationDecision(
  trigger: VoiceFinalizationTrigger,
  phase: VoicePhase,
  turns: readonly VoiceTranscriptTurn[]
): VoiceFinalizationDecision {
  if (
    trigger === 'manual' &&
    (phase === 'transcribing' || phase === 'safety_checking' || phase === 'refining')
  ) {
    return 'blocked';
  }
  const built = buildVoiceRefinementNotes(turns);
  if (built.overflow) return 'reject_oversized_transcript';
  return built.notes.length > 0 ? 'refine' : 'end_without_refinement';
}

export function tryBeginVoiceFinalization(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function shouldIgnoreRealtimeEventDuringFinalization(
  finalizationInFlight: boolean
): boolean {
  return finalizationInFlight;
}

export function isRealtimeEventFromCurrentOperation(
  eventOperation: number,
  currentOperation: number
): boolean {
  return eventOperation === currentOperation;
}

export function shouldFinalizeAfterAllowedTurn(
  turns: readonly VoiceTranscriptTurn[]
): boolean {
  const built = buildVoiceRefinementNotes(turns);
  return built.overflow || built.notes.length >= MAX_VOICE_REFINEMENT_NOTES;
}

export interface ManualVoiceFinalizationGate {
  readonly phase: VoicePhase;
  readonly safetyInFlight: boolean;
  readonly turnGateClosed: boolean;
  readonly hasPendingActiveItem: boolean;
  readonly hasPendingSuppressedItems: boolean;
  readonly approvedResponseInFlight: boolean;
}

export function shouldBlockManualVoiceFinalization({
  phase,
  safetyInFlight,
  turnGateClosed,
  hasPendingActiveItem,
  hasPendingSuppressedItems,
  approvedResponseInFlight
}: ManualVoiceFinalizationGate): boolean {
  if (
    phase === 'transcribing' ||
    phase === 'safety_checking' ||
    phase === 'refining'
  ) {
    return true;
  }
  return (
    safetyInFlight ||
    hasPendingActiveItem ||
    hasPendingSuppressedItems ||
    (turnGateClosed && !approvedResponseInFlight)
  );
}

export function voiceSessionRequestFromSelection(
  voiceContextToken: VoiceContextToken,
  selectedDraft: string
): VoiceSessionRequest {
  return VoiceSessionRequestSchema.parse({
    voiceContextToken,
    selectedDraft: compactVoiceNote(selectedDraft),
    adultConfirmed: true
  });
}

export interface PreparedVoiceFinalization {
  decision: VoiceFinalizationDecision;
  notes: VoiceRefinementNote[];
}

export function prepareVoiceFinalization(
  trigger: VoiceFinalizationTrigger,
  phase: VoicePhase,
  turns: readonly VoiceTranscriptTurn[],
  originalRequest: GuidanceRequest,
  selectedDraft: string
): PreparedVoiceFinalization {
  const built = buildVoiceRefinementNotes(turns);
  let decision = voiceFinalizationDecision(trigger, phase, turns);
  if (
    decision === 'refine' &&
    !VoiceRefinementRequestSchema.safeParse({
      originalRequest,
      notes: built.notes,
      selectedDraft: compactVoiceNote(selectedDraft)
    }).success
  ) {
    decision = 'reject_context_budget';
  }
  return {
    decision,
    notes: built.notes
  };
}

export type VoiceFinalizationOutcome =
  | { status: 'blocked' }
  | { status: 'ended_without_refinement' }
  | { status: 'rejected_context_budget' }
  | { status: 'rejected_oversized_transcript' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }
  | { status: 'refined'; result: VoiceRefinementResponse };

export async function runPreparedVoiceFinalization({
  prepared,
  originalRequest,
  selectedDraft,
  stopSession,
  refine,
  shouldContinue = () => true,
  signal
}: {
  prepared: PreparedVoiceFinalization;
  originalRequest: GuidanceRequest;
  selectedDraft: string;
  stopSession: () => Promise<void>;
  refine: VoiceApiClient['refine'];
  shouldContinue?: () => boolean;
  signal?: AbortSignal;
}): Promise<VoiceFinalizationOutcome> {
  if (prepared.decision === 'blocked') return { status: 'blocked' };

  try {
    await stopSession();
    if (!shouldContinue()) return { status: 'cancelled' };
    if (prepared.decision === 'end_without_refinement') {
      return { status: 'ended_without_refinement' };
    }
    if (prepared.decision === 'reject_oversized_transcript') {
      return { status: 'rejected_oversized_transcript' };
    }
    if (prepared.decision === 'reject_context_budget') {
      return { status: 'rejected_context_budget' };
    }

    const input: VoiceRefinementRequest = {
      originalRequest,
      notes: prepared.notes,
      selectedDraft: compactVoiceNote(selectedDraft)
    };
    const result = signal
      ? await refine(input, { signal })
      : await refine(input);
    if (!shouldContinue()) return { status: 'cancelled' };
    return { status: 'refined', result };
  } catch (error: unknown) {
    return { status: 'failed', error };
  }
}

export async function createSessionAfterPreviousLeaseEnds<T>(
  endPreviousLease: () => Promise<void>,
  createSession: () => Promise<T>,
  shouldContinue: () => boolean = () => true
): Promise<T> {
  await endPreviousLease();
  if (!shouldContinue()) throw new Error('Voice session start was cancelled.');
  return createSession();
}

export async function prepareControllerBeforeCreatingSession<T>(
  controller: VoiceRealtimeController,
  createSession: () => Promise<T>
): Promise<T> {
  await controller.prepare?.();
  return createSession();
}

export function requestResponseAfterSafetyAllow(
  controller: VoiceRealtimeController,
  onRequested: () => void
): void {
  controller.requestResponse();
  onRequested();
}

export function muteBeforeTurnGate(
  controller: VoiceRealtimeController,
  onMuted: () => void
): void {
  controller.mute(true);
  onMuted();
}

export function shouldUnmuteAfterInterruption(
  safetyInFlight: boolean,
  turnGateClosed: boolean
): boolean {
  return !safetyInFlight && !turnGateClosed;
}

export function classifyRealtimeSpeechStart(
  responseInFlight: boolean,
  turnGateClosed: boolean,
  itemId: string,
  activeItemId: string | null
): 'listen' | 'interrupt_response' | 'wait_for_gate' | 'suppress_item' | 'unsafe_overlap' {
  if (turnGateClosed) {
    if (itemId === activeItemId) return 'wait_for_gate';
    return responseInFlight ? 'unsafe_overlap' : 'suppress_item';
  }
  if (activeItemId && activeItemId !== itemId) return 'unsafe_overlap';
  return responseInFlight ? 'interrupt_response' : 'listen';
}

type RealtimeSpeechStopDecision =
  | 'close_gate'
  | 'wait_for_gate'
  | 'suppress_item'
  | 'unsafe_overlap';

type RealtimeTranscriptDisposition = 'check' | 'discard' | 'unsafe_overlap';

export class RealtimeTurnItemGuard {
  readonly #suppressedItemIds = new Set<string>();
  readonly #deleteRequestedItemIds = new Set<string>();
  readonly #discardedItemIds = new Set<string>();
  #activeItemId: string | null = null;
  #activeItemPendingCheck = false;

  public get hasPendingActiveItem(): boolean {
    return this.#activeItemPendingCheck;
  }

  public get hasPendingSuppressedItems(): boolean {
    return this.#suppressedItemIds.size > 0;
  }

  public isAwaitingTranscriptTerminal(itemId: string): boolean {
    return (
      this.#suppressedItemIds.has(itemId) &&
      !this.#deleteRequestedItemIds.has(itemId)
    );
  }

  public speechStarted(
    itemId: string,
    responseInFlight: boolean,
    turnGateClosed: boolean
  ): ReturnType<typeof classifyRealtimeSpeechStart> {
    const decision = classifyRealtimeSpeechStart(
      responseInFlight,
      turnGateClosed,
      itemId,
      this.#activeItemId
    );
    if (decision === 'listen' || decision === 'interrupt_response') {
      this.#activeItemId = itemId;
      this.#activeItemPendingCheck = true;
    } else if (decision === 'suppress_item') {
      this.#suppressedItemIds.add(itemId);
    }
    return decision;
  }

  public speechStopped(
    itemId: string,
    responseInFlight: boolean,
    turnGateClosed: boolean
  ): RealtimeSpeechStopDecision {
    if (this.#suppressedItemIds.has(itemId) || this.#discardedItemIds.has(itemId)) {
      return 'suppress_item';
    }
    if (turnGateClosed) {
      if (itemId === this.#activeItemId) return 'wait_for_gate';
      if (responseInFlight) return 'unsafe_overlap';
      this.#suppressedItemIds.add(itemId);
      return 'suppress_item';
    }
    if (this.#activeItemId && this.#activeItemId !== itemId) return 'unsafe_overlap';
    this.#activeItemId = itemId;
    this.#activeItemPendingCheck = true;
    return 'close_gate';
  }

  public transcriptDisposition(itemId: string): RealtimeTranscriptDisposition {
    if (this.#suppressedItemIds.has(itemId) || this.#discardedItemIds.has(itemId)) {
      return 'discard';
    }
    return itemId === this.#activeItemId ? 'check' : 'unsafe_overlap';
  }

  public requestSuppressedItemDeletion(itemId: string): 'delete_item' | 'none' {
    if (
      !this.#suppressedItemIds.has(itemId) ||
      this.#deleteRequestedItemIds.has(itemId)
    ) {
      return 'none';
    }
    this.#deleteRequestedItemIds.add(itemId);
    return 'delete_item';
  }

  public userItemDeleted(itemId: string): 'expected' | 'duplicate' | 'unexpected' {
    if (this.#discardedItemIds.has(itemId)) return 'duplicate';
    const expected =
      this.#suppressedItemIds.delete(itemId) ||
      this.#deleteRequestedItemIds.has(itemId);
    this.#deleteRequestedItemIds.delete(itemId);
    if (!expected) return 'unexpected';
    this.#discardedItemIds.add(itemId);
    return 'expected';
  }

  public markActiveItemChecked(itemId: string): boolean {
    if (this.#activeItemId !== itemId || !this.#activeItemPendingCheck) return false;
    this.#activeItemPendingCheck = false;
    return true;
  }

  public clearActiveItem(): void {
    this.#activeItemId = null;
    this.#activeItemPendingCheck = false;
  }

  public reset(): void {
    this.#activeItemId = null;
    this.#activeItemPendingCheck = false;
    this.#suppressedItemIds.clear();
    this.#deleteRequestedItemIds.clear();
    this.#discardedItemIds.clear();
  }
}

export function classifyDeletedConversationItemAck(
  itemGuard: Pick<RealtimeTurnItemGuard, 'userItemDeleted'>,
  itemId: string
): 'expected' | 'duplicate' | 'unexpected' {
  return itemGuard.userItemDeleted(itemId);
}

export function canRequestApprovedRealtimeResponse(
  approvedResponseWaiting: boolean,
  itemGuard: Pick<RealtimeTurnItemGuard, 'hasPendingSuppressedItems'>
): boolean {
  return approvedResponseWaiting && !itemGuard.hasPendingSuppressedItems;
}

export const SUPPRESSED_ITEM_DELETE_ACK_TIMEOUT_MS = 4_000;
export const SUPPRESSED_ITEM_TRANSCRIPT_TERMINAL_TIMEOUT_MS = 10_000;

type DeleteAckTimeout = ReturnType<typeof setTimeout>;

export function startSuppressedItemDeleteAckTimeout(
  timeouts: Map<string, DeleteAckTimeout>,
  itemId: string,
  onTimeout: (timedOutItemId: string) => void,
  timeoutMs = SUPPRESSED_ITEM_DELETE_ACK_TIMEOUT_MS
): void {
  const previousTimeout = timeouts.get(itemId);
  if (previousTimeout) clearTimeout(previousTimeout);

  const timeout = setTimeout(() => {
    if (timeouts.get(itemId) !== timeout) return;
    timeouts.delete(itemId);
    onTimeout(itemId);
  }, timeoutMs);
  timeouts.set(itemId, timeout);
}

export function clearSuppressedItemDeleteAckTimeout(
  timeouts: Map<string, DeleteAckTimeout>,
  itemId: string
): boolean {
  const timeout = timeouts.get(itemId);
  if (!timeout) return false;
  clearTimeout(timeout);
  timeouts.delete(itemId);
  return true;
}

export function clearSuppressedItemDeleteAckTimeouts(
  timeouts: Map<string, DeleteAckTimeout>
): void {
  timeouts.forEach((timeout) => clearTimeout(timeout));
  timeouts.clear();
}

export function startSuppressedItemTranscriptTerminalTimeout(
  timeouts: Map<string, DeleteAckTimeout>,
  itemId: string,
  onTimeout: (timedOutItemId: string) => void,
  timeoutMs = SUPPRESSED_ITEM_TRANSCRIPT_TERMINAL_TIMEOUT_MS
): void {
  if (timeouts.has(itemId)) return;
  const timeout = setTimeout(() => {
    if (timeouts.get(itemId) !== timeout) return;
    timeouts.delete(itemId);
    onTimeout(itemId);
  }, timeoutMs);
  timeouts.set(itemId, timeout);
}

export function clearSuppressedItemTranscriptTerminalTimeout(
  timeouts: Map<string, DeleteAckTimeout>,
  itemId: string
): boolean {
  return clearSuppressedItemDeleteAckTimeout(timeouts, itemId);
}

export function clearSuppressedItemTranscriptTerminalTimeouts(
  timeouts: Map<string, DeleteAckTimeout>
): void {
  clearSuppressedItemDeleteAckTimeouts(timeouts);
}

export function dispatchVoiceFailurePreservingProgress(
  dispatchAction: (action: VoiceAction) => void,
  message: string
): void {
  dispatchAction({ type: 'error', message });
}

export type RealtimeResponseLifecycle = Readonly<{
  pending: boolean;
  active: boolean;
  activeResponseId: string | null;
}>;

export type RealtimeResponseLifecycleEvent =
  | { readonly type: 'approved' }
  | { readonly type: 'started'; readonly responseId: string }
  | {
      readonly type: 'completed';
      readonly responseId: string;
      readonly status: string;
    }
  | { readonly type: 'cancelled' };

export function reduceRealtimeResponseLifecycle(
  current: RealtimeResponseLifecycle,
  event: RealtimeResponseLifecycleEvent
): RealtimeResponseLifecycle & {
  readonly action:
    | 'none'
    | 'activate'
    | 'complete'
    | 'terminal_error'
    | 'unexpected';
} {
  switch (event.type) {
    case 'approved':
      return {
        pending: true,
        active: false,
        activeResponseId: null,
        action: 'none'
      };
    case 'started':
      return current.pending
        ? {
            pending: false,
            active: true,
            activeResponseId: event.responseId,
            action: 'activate'
          }
        : {
            ...current,
            action:
              current.active && current.activeResponseId === event.responseId
                ? 'none'
                : 'unexpected'
          };
    case 'completed':
      if (!current.active || current.activeResponseId !== event.responseId) {
        return { ...current, action: 'none' };
      }
      return {
        pending: false,
        active: false,
        activeResponseId: null,
        action: event.status === 'completed' ? 'complete' : 'terminal_error'
      };
    case 'cancelled':
      return {
        pending: false,
        active: false,
        activeResponseId: null,
        action: 'none'
      };
  }
}

export function classifyCompletedVoiceTurn(
  itemId: string,
  processedTurnIds: ReadonlySet<string>,
  turnProcessingInFlight: boolean
): 'check' | 'duplicate' | 'overlap' {
  if (processedTurnIds.has(itemId)) return 'duplicate';
  return turnProcessingInFlight ? 'overlap' : 'check';
}

export async function endVoiceLeaseWithBoundedRetry(
  endLease: () => Promise<void>,
  attempts = 2
): Promise<boolean> {
  const boundedAttempts = Math.max(1, Math.floor(attempts));
  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    try {
      await endLease();
      return true;
    } catch {
      // Retry only within the small caller-supplied bound.
    }
  }
  return false;
}

export function phaseAfterRealtimeBoundary(
  currentPhase: VoicePhase,
  event: Extract<VoiceRealtimeEvent, { type: 'speech_started' | 'speech_stopped' | 'interrupted' }>
): VoicePhase | undefined {
  if (event.type === 'interrupted') return 'listening';
  if (event.type === 'speech_started') {
    return ['listening', 'thinking', 'speaking'].includes(currentPhase)
      ? 'listening'
      : undefined;
  }
  return currentPhase === 'listening' ? 'transcribing' : undefined;
}

export function useRealtimeVoice({
  capabilities,
  voiceContextToken,
  originalRequest,
  selectedDraft,
  controllerFactory = createOpenAiRealtimeVoiceController,
  apiClient = defaultVoiceApiClient,
  onRefined
}: UseRealtimeVoiceOptions): RealtimeVoiceControls {
  const [state, dispatch] = useReducer(
    voiceReducer,
    capabilities.maxSessionSeconds,
    createInitialVoiceState
  );
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const controllerRef = useRef<VoiceRealtimeController | null>(null);
  const leaseRef = useRef<VoiceSessionResponse['sessionLeaseId'] | null>(null);
  const leaseReleaseRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef(0);
  const maxSecondsRef = useRef(capabilities.maxSessionSeconds);
  const safetyInFlightRef = useRef(false);
  const turnGateClosedRef = useRef(false);
  const responseLifecycleRef = useRef<RealtimeResponseLifecycle>({
    pending: false,
    active: false,
    activeResponseId: null
  });
  const turnItemGuardRef = useRef(new RealtimeTurnItemGuard());
  const approvedResponseWaitingRef = useRef(false);
  const deleteAckTimeoutsRef = useRef(new Map<string, DeleteAckTimeout>());
  const transcriptTerminalTimeoutsRef = useRef(
    new Map<string, DeleteAckTimeout>()
  );
  const refineAbortRef = useRef<AbortController | null>(null);
  const finalizationInFlightRef = useRef(false);
  const processedTurnIdsRef = useRef(new Set<string>());
  const approvedTurnsRef = useRef<VoiceTranscriptTurn[]>([]);
  const eventHandlerRef = useRef<(event: VoiceRealtimeEvent) => void>(() => undefined);
  const timeoutHandlerRef = useRef<() => void>(() => undefined);
  const finalizationHandlerRef = useRef<
    (trigger: VoiceFinalizationTrigger) => Promise<void>
  >(async () => undefined);

  stateRef.current = state;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    deadlineRef.current = 0;
  }, []);

  const abortRefinement = useCallback(() => {
    refineAbortRef.current?.abort();
    refineAbortRef.current = null;
  }, []);

  const closeController = useCallback(() => {
    const controller = controllerRef.current;
    controllerRef.current = null;
    responseLifecycleRef.current = {
      pending: false,
      active: false,
      activeResponseId: null
    };
    approvedResponseWaitingRef.current = false;
    turnItemGuardRef.current.reset();
    clearSuppressedItemDeleteAckTimeouts(deleteAckTimeoutsRef.current);
    clearSuppressedItemTranscriptTerminalTimeouts(
      transcriptTerminalTimeoutsRef.current
    );
    safetyInFlightRef.current = false;
    turnGateClosedRef.current = false;
    if (controller) controller.close();
  }, []);

  const releaseLease = useCallback(
    async (keepalive = false): Promise<void> => {
      const release = leaseReleaseRef.current.then(async () => {
        const sessionLeaseId = leaseRef.current;
        if (!sessionLeaseId) return;
        const released = await endVoiceLeaseWithBoundedRetry(() =>
          apiClient.endSession({ sessionLeaseId }, { keepalive })
        );
        if (released && leaseRef.current === sessionLeaseId) {
          leaseRef.current = null;
        }
      });
      leaseReleaseRef.current = release;
      await release;
    },
    [apiClient]
  );

  const stopSession = useCallback(
    async (keepalive = false): Promise<void> => {
      clearTimer();
      closeController();
      await releaseLease(keepalive);
    },
    [clearTimer, closeController, releaseLease]
  );

  const failClosed = useCallback(
    (message: string) => {
      operationRef.current += 1;
      finalizationInFlightRef.current = false;
      void stopSession();
      processedTurnIdsRef.current.clear();
      if (!mountedRef.current) return;
      dispatchVoiceFailurePreservingProgress(dispatch, message);
    },
    [stopSession]
  );

  const endAfterTimeout = useCallback(() => {
    if (!mountedRef.current) return;
    dispatch({ type: 'tick', remainingSeconds: 0 });
    void finalizationHandlerRef.current('timeout');
  }, []);

  timeoutHandlerRef.current = endAfterTimeout;

  const startTimer = useCallback(
    (seconds: number) => {
      clearTimer();
      const boundedSeconds = Math.max(1, Math.floor(seconds));
      deadlineRef.current = Date.now() + boundedSeconds * 1_000;
      dispatch({ type: 'tick', remainingSeconds: boundedSeconds });
      timerRef.current = setInterval(() => {
        const remaining = Math.max(
          0,
          Math.ceil((deadlineRef.current - Date.now()) / 1_000)
        );
        if (mountedRef.current) dispatch({ type: 'tick', remainingSeconds: remaining });
        if (remaining === 0) timeoutHandlerRef.current();
      }, 1_000);
    },
    [clearTimer]
  );

  const requestApprovedResponseIfReady = useCallback(() => {
    if (
      !canRequestApprovedRealtimeResponse(
        approvedResponseWaitingRef.current,
        turnItemGuardRef.current
      )
    ) {
      return;
    }
    const controller = controllerRef.current;
    if (!controller) return;
    approvedResponseWaitingRef.current = false;
    responseLifecycleRef.current = reduceRealtimeResponseLifecycle(
      responseLifecycleRef.current,
      { type: 'approved' }
    );
    try {
      requestResponseAfterSafetyAllow(controller, () =>
        dispatch({ type: 'phase', phase: 'thinking' })
      );
    } catch (error: unknown) {
      failClosed(
        errorMessage(error, '无法在安全检查后请求语音回复，已停止本次连接。')
      );
    }
  }, [failClosed]);

  const handleAllowedTurn = useCallback(
    (itemId: string, transcript: string) => {
      const controller = controllerRef.current;
      if (!controller) return;
      const nextTurns = [
        ...approvedTurnsRef.current,
        { id: itemId, transcript: transcript.trim() }
      ];
      approvedTurnsRef.current = nextTurns;
      dispatch({ type: 'turn_completed', id: itemId, transcript });
      dispatch({ type: 'assistant_reset' });
      if (shouldFinalizeAfterAllowedTurn(nextTurns)) {
        void finalizationHandlerRef.current('turn_limit');
        return;
      }
      dispatch({ type: 'phase', phase: 'thinking' });
      approvedResponseWaitingRef.current = true;
      requestApprovedResponseIfReady();
    },
    [requestApprovedResponseIfReady]
  );

  const deleteSuppressedItemIfAvailable = useCallback(
    (itemId: string): boolean => {
      if (
        turnItemGuardRef.current.requestSuppressedItemDeletion(itemId) !== 'delete_item'
      ) {
        return true;
      }
      const operation = operationRef.current;
      // Let the SDK finish handling the transcription event before deleting its item.
      // Otherwise the SDK's immediate item retrieval can race the deletion and emit an error.
      queueMicrotask(() => {
        if (!mountedRef.current || operation !== operationRef.current) return;
        const controller = controllerRef.current;
        if (!controller) {
          failClosed('无法隔离未检查的语音片段，本次连接已经停止。');
          return;
        }
        startSuppressedItemDeleteAckTimeout(
          deleteAckTimeoutsRef.current,
          itemId,
          () => {
            if (operation !== operationRef.current) return;
            failClosed('等待隔离未检查语音片段超时，本次连接已经停止。');
          }
        );
        try {
          controller.deleteConversationItem(itemId);
        } catch {
          clearSuppressedItemDeleteAckTimeout(deleteAckTimeoutsRef.current, itemId);
          failClosed('无法隔离未检查的语音片段，本次连接已经停止。');
        }
      });
      return true;
    },
    [failClosed]
  );

  const ensureSuppressedItemTranscriptTerminalTimeout = useCallback(
    (itemId: string): void => {
      const operation = operationRef.current;
      startSuppressedItemTranscriptTerminalTimeout(
        transcriptTerminalTimeoutsRef.current,
        itemId,
        () => {
          if (operation !== operationRef.current) return;
          failClosed('等待未检查语音片段的转写结果超时，本次连接已经停止。');
        }
      );
    },
    [failClosed]
  );

  const checkCompletedTranscript = useCallback(
    async (itemId: string, transcript: string): Promise<void> => {
      if (processedTurnIdsRef.current.has(itemId)) return;
      const transcriptDisposition = turnItemGuardRef.current.transcriptDisposition(itemId);
      if (transcriptDisposition === 'discard') {
        deleteSuppressedItemIfAvailable(itemId);
        return;
      }
      if (transcriptDisposition === 'unsafe_overlap') {
        failClosed('语音转写顺序出现异常。为避免跳过安全检查，本次连接已经停止。');
        return;
      }
      const classification = classifyCompletedVoiceTurn(
        itemId,
        processedTurnIdsRef.current,
        safetyInFlightRef.current ||
          responseLifecycleRef.current.pending ||
          responseLifecycleRef.current.active
      );
      if (classification === 'duplicate') return;
      if (classification === 'overlap') {
        failClosed('语音转写顺序出现异常。为避免跳过安全检查，本次连接已经停止。');
        return;
      }
      processedTurnIdsRef.current.add(itemId);
      const sessionLeaseId = leaseRef.current;
      const controller = controllerRef.current;
      if (!sessionLeaseId || !controller) return;

      turnGateClosedRef.current = true;
      safetyInFlightRef.current = true;
      try {
        muteBeforeTurnGate(controller, () => dispatch({ type: 'muted', muted: true }));
      } catch {
        failClosed('无法在安全检查期间暂停麦克风，本次连接已经停止。');
        return;
      }
      dispatch({ type: 'phase', phase: 'safety_checking' });
      const operation = operationRef.current;

      try {
        const result = await apiClient.checkTurnSafety({
          sessionLeaseId,
          transcript,
          adultConfirmed: true
        });
        if (operation !== operationRef.current || !mountedRef.current) return;
        safetyInFlightRef.current = false;

        if (result.action === 'safety_stop') {
          controller.interrupt();
          void stopSession();
          processedTurnIdsRef.current.clear();
          approvedTurnsRef.current = [];
          dispatch({ type: 'reset', maxSessionSeconds: maxSecondsRef.current });
          dispatch({ type: 'safety_stop', notice: result.responseText });
          return;
        }
        if (!turnItemGuardRef.current.markActiveItemChecked(itemId)) {
          failClosed('语音条目检查状态异常，本次连接已经停止。');
          return;
        }
        handleAllowedTurn(itemId, transcript);
      } catch (error: unknown) {
        if (operation !== operationRef.current) return;
        failClosed(
          errorMessage(error, '这轮语音没有通过安全检查，已停止本次连接。')
        );
      }
    },
    [apiClient, deleteSuppressedItemIfAvailable, failClosed, handleAllowedTurn, stopSession]
  );

  const handleRealtimeEvent = useCallback(
    (event: VoiceRealtimeEvent) => {
      if (
        !mountedRef.current ||
        shouldIgnoreRealtimeEventDuringFinalization(finalizationInFlightRef.current)
      ) {
        return;
      }
      switch (event.type) {
        case 'connected':
          turnItemGuardRef.current.clearActiveItem();
          dispatch({ type: 'phase', phase: 'listening' });
          break;
        case 'speech_started': {
          const responseInFlight =
            responseLifecycleRef.current.pending || responseLifecycleRef.current.active;
          switch (
            turnItemGuardRef.current.speechStarted(
              event.itemId,
              responseInFlight,
              turnGateClosedRef.current
            )
          ) {
            case 'wait_for_gate':
            case 'suppress_item': {
              if (turnItemGuardRef.current.isAwaitingTranscriptTerminal(event.itemId)) {
                ensureSuppressedItemTranscriptTerminalTimeout(event.itemId);
              }
              const controller = controllerRef.current;
              try {
                if (controller) {
                  muteBeforeTurnGate(controller, () =>
                    dispatch({ type: 'muted', muted: true })
                  );
                }
              } catch {
                failClosed('无法在处理上一句话时保持麦克风静音，本次连接已经停止。');
                return;
              }
              dispatch({
                type: 'phase',
                phase: safetyInFlightRef.current ? 'safety_checking' : 'transcribing'
              });
              return;
            }
            case 'unsafe_overlap':
              failClosed(
                '检测到新的未检查语音片段。为避免它进入回复上下文，本次连接已经停止。'
              );
              return;
            case 'interrupt_response':
              controllerRef.current?.interrupt();
              responseLifecycleRef.current = reduceRealtimeResponseLifecycle(
                responseLifecycleRef.current,
                { type: 'cancelled' }
              );
              break;
            case 'listen':
              break;
          }
          if (phaseAfterRealtimeBoundary(stateRef.current.phase, event)) {
            dispatch({ type: 'assistant_reset' });
            dispatch({ type: 'phase', phase: 'listening' });
          }
          break;
        }
        case 'speech_stopped': {
          const responseInFlight =
            responseLifecycleRef.current.pending || responseLifecycleRef.current.active;
          const decision = turnItemGuardRef.current.speechStopped(
            event.itemId,
            responseInFlight,
            turnGateClosedRef.current
          );
          if (decision === 'unsafe_overlap') {
            failClosed(
              '检测到新的未检查语音片段。为避免它进入回复上下文，本次连接已经停止。'
            );
            return;
          }
          if (decision === 'wait_for_gate' || decision === 'suppress_item') {
            if (turnItemGuardRef.current.isAwaitingTranscriptTerminal(event.itemId)) {
              ensureSuppressedItemTranscriptTerminalTimeout(event.itemId);
            }
            try {
              const controller = controllerRef.current;
              if (controller) {
                muteBeforeTurnGate(controller, () =>
                  dispatch({ type: 'muted', muted: true })
                );
              }
            } catch {
              failClosed('无法在处理上一句话时保持麦克风静音，本次连接已经停止。');
            }
            return;
          }
          turnGateClosedRef.current = true;
          try {
            const controller = controllerRef.current;
            if (controller) {
              muteBeforeTurnGate(controller, () =>
                dispatch({ type: 'muted', muted: true })
              );
            }
          } catch {
            failClosed('无法在转写和安全检查期间暂停麦克风，本次连接已经停止。');
            return;
          }
          const nextPhase = phaseAfterRealtimeBoundary(stateRef.current.phase, event);
          if (nextPhase) dispatch({ type: 'phase', phase: nextPhase });
          break;
        }
        case 'user_item_deleted': {
          clearSuppressedItemDeleteAckTimeout(deleteAckTimeoutsRef.current, event.itemId);
          clearSuppressedItemTranscriptTerminalTimeout(
            transcriptTerminalTimeoutsRef.current,
            event.itemId
          );
          const disposition = classifyDeletedConversationItemAck(
            turnItemGuardRef.current,
            event.itemId
          );
          if (disposition === 'unexpected') {
            failClosed('收到非预期的语音条目删除确认，本次连接已经停止。');
            return;
          }
          if (disposition === 'duplicate') return;
          requestApprovedResponseIfReady();
          break;
        }
        case 'user_transcript_completed':
          clearSuppressedItemTranscriptTerminalTimeout(
            transcriptTerminalTimeoutsRef.current,
            event.itemId
          );
          void checkCompletedTranscript(event.itemId, event.transcript);
          break;
        case 'transcription_failed': {
          clearSuppressedItemTranscriptTerminalTimeout(
            transcriptTerminalTimeoutsRef.current,
            event.itemId
          );
          const disposition = turnItemGuardRef.current.transcriptDisposition(event.itemId);
          if (disposition === 'discard') {
            deleteSuppressedItemIfAvailable(event.itemId);
            return;
          }
          failClosed('没有拿到完整转写。为避免模型跳过检查，本次连接已经停止。');
          break;
        }
        case 'assistant_transcript_delta':
          if (responseLifecycleRef.current.active) {
            dispatch({ type: 'assistant_delta', delta: event.delta });
          }
          break;
        case 'response_started': {
          const next = reduceRealtimeResponseLifecycle(
            responseLifecycleRef.current,
            { type: 'started', responseId: event.responseId }
          );
          responseLifecycleRef.current = next;
          if (next.action === 'unexpected') {
            controllerRef.current?.interrupt();
            failClosed('检测到未经安全检查的自动回复，本次连接已经停止。');
            return;
          }
          if (next.action === 'activate') {
            turnGateClosedRef.current = false;
            turnItemGuardRef.current.clearActiveItem();
            controllerRef.current?.mute(false);
            dispatch({ type: 'muted', muted: false });
            dispatch({ type: 'phase', phase: 'speaking' });
          }
          break;
        }
        case 'response_completed': {
          const next = reduceRealtimeResponseLifecycle(
            responseLifecycleRef.current,
            {
              type: 'completed',
              responseId: event.responseId,
              status: event.status
            }
          );
          responseLifecycleRef.current = next;
          if (next.action === 'terminal_error') {
            failClosed('语音回复没有完整完成，本次连接已经停止。原来的文字建议仍然保留。');
            return;
          }
          if (next.action !== 'complete') return;
          if (turnGateClosedRef.current) return;
          controllerRef.current?.mute(false);
          dispatch({ type: 'muted', muted: false });
          dispatch({ type: 'phase', phase: 'listening' });
          break;
        }
        case 'interrupted':
          responseLifecycleRef.current = reduceRealtimeResponseLifecycle(
            responseLifecycleRef.current,
            { type: 'cancelled' }
          );
          if (
            !shouldUnmuteAfterInterruption(
              safetyInFlightRef.current,
              turnGateClosedRef.current
            )
          ) {
            return;
          }
          controllerRef.current?.mute(false);
          dispatch({ type: 'muted', muted: false });
          dispatch({
            type: 'phase',
            phase: phaseAfterRealtimeBoundary(stateRef.current.phase, event) ?? 'listening'
          });
          break;
        case 'error':
          failClosed(event.message);
          break;
      }
    },
    [
      checkCompletedTranscript,
      deleteSuppressedItemIfAvailable,
      ensureSuppressedItemTranscriptTerminalTimeout,
      failClosed,
      requestApprovedResponseIfReady
    ]
  );

  eventHandlerRef.current = handleRealtimeEvent;

  const start = useCallback(async (): Promise<void> => {
    abortRefinement();
    finalizationInFlightRef.current = false;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    processedTurnIdsRef.current.clear();
    approvedTurnsRef.current = [];
    dispatch({ type: 'reset', maxSessionSeconds: capabilities.maxSessionSeconds });
    dispatch({ type: 'phase', phase: 'requesting_permission' });

    try {
      const prepared = await createSessionAfterPreviousLeaseEnds(
        () => stopSession(),
        async () => {
          const controller = controllerFactory();
          controllerRef.current = controller;
          const session = await prepareControllerBeforeCreatingSession(
            controller,
            async () => {
              if (operation !== operationRef.current || !mountedRef.current) {
                controller.close();
                throw new Error('Voice session start was cancelled.');
              }
              return apiClient.createSession(
                voiceSessionRequestFromSelection(voiceContextToken, selectedDraft)
              );
            }
          );
          return { controller, session };
        },
        () => operation === operationRef.current && mountedRef.current
      );
      const { controller, session } = prepared;
      if (operation !== operationRef.current || !mountedRef.current) {
        controller.close();
        void apiClient
          .endSession({ sessionLeaseId: session.sessionLeaseId })
          .catch(() => undefined);
        return;
      }

      leaseRef.current = session.sessionLeaseId;
      maxSecondsRef.current = session.maxSessionSeconds;
      dispatch({ type: 'reset', maxSessionSeconds: session.maxSessionSeconds });
      dispatch({ type: 'phase', phase: 'connecting' });
      startTimer(session.maxSessionSeconds);

      await controller.connect(
        realtimeConnectionOptionsFromSession(session, (event) => {
          if (!isRealtimeEventFromCurrentOperation(operation, operationRef.current)) return;
          eventHandlerRef.current(event);
        })
      );
      if (operation !== operationRef.current) controller.close();
    } catch (error: unknown) {
      if (operation !== operationRef.current) return;
      failClosed(
        errorMessage(error, '语音连接没有建立成功，原来的文字建议仍然保留。')
      );
    }
  }, [
    apiClient,
    abortRefinement,
    capabilities.maxSessionSeconds,
    controllerFactory,
    failClosed,
    startTimer,
    stopSession,
    selectedDraft,
    voiceContextToken
  ]);

  const retry = useCallback(async (): Promise<void> => start(), [start]);

  const toggleMute = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || stateRef.current.phase !== 'listening') return;
    const muted = !stateRef.current.muted;
    controller.mute(muted);
    dispatch({ type: 'muted', muted });
  }, []);

  const interrupt = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || !responseLifecycleRef.current.active) {
      return;
    }
    controller.interrupt();
    responseLifecycleRef.current = reduceRealtimeResponseLifecycle(
      responseLifecycleRef.current,
      { type: 'cancelled' }
    );
    controller.mute(false);
    dispatch({ type: 'muted', muted: false });
    dispatch({ type: 'phase', phase: 'listening' });
  }, []);

  const finalizeSession = useCallback(
    async (trigger: VoiceFinalizationTrigger): Promise<void> => {
      const snapshot = stateRef.current;
      const responseLifecycle = responseLifecycleRef.current;
      if (
        trigger === 'manual' &&
        shouldBlockManualVoiceFinalization({
          phase: snapshot.phase,
          safetyInFlight: safetyInFlightRef.current,
          turnGateClosed: turnGateClosedRef.current,
          hasPendingActiveItem: turnItemGuardRef.current.hasPendingActiveItem,
          hasPendingSuppressedItems:
            turnItemGuardRef.current.hasPendingSuppressedItems,
          approvedResponseInFlight:
            approvedResponseWaitingRef.current ||
            responseLifecycle.pending ||
            responseLifecycle.active
        })
      ) {
        return;
      }
      const approvedTurns = approvedTurnsRef.current;
      const prepared = prepareVoiceFinalization(
        trigger,
        snapshot.phase,
        approvedTurns,
        originalRequest,
        selectedDraft
      );
      if (
        prepared.decision === 'blocked' ||
        !tryBeginVoiceFinalization(finalizationInFlightRef)
      ) {
        return;
      }

      const operation = operationRef.current + 1;
      operationRef.current = operation;
      abortRefinement();

      const controller = controllerRef.current;
      if (
        controller &&
        (responseLifecycleRef.current.pending ||
          responseLifecycleRef.current.active ||
          snapshot.phase === 'thinking' ||
          snapshot.phase === 'speaking')
      ) {
        try {
          controller.interrupt();
        } catch {
          // Closing the controller below is the authoritative stop boundary.
        }
        responseLifecycleRef.current = reduceRealtimeResponseLifecycle(
          responseLifecycleRef.current,
          { type: 'cancelled' }
        );
      }

      const refineController =
        prepared.decision === 'refine' ? new AbortController() : null;
      if (refineController) {
        refineAbortRef.current = refineController;
        dispatch({ type: 'phase', phase: 'refining' });
      }

      try {
        const outcome = await runPreparedVoiceFinalization({
          prepared,
          originalRequest,
          selectedDraft,
          stopSession,
          refine: apiClient.refine,
          shouldContinue: () =>
            operation === operationRef.current && mountedRef.current,
          ...(refineController ? { signal: refineController.signal } : {})
        });
        if (operation !== operationRef.current || !mountedRef.current) return;

        switch (outcome.status) {
          case 'blocked':
          case 'cancelled':
            return;
          case 'ended_without_refinement':
            processedTurnIdsRef.current.clear();
            approvedTurnsRef.current = [];
            dispatch({ type: 'phase', phase: 'ended' });
            return;
          case 'rejected_oversized_transcript':
            dispatchVoiceFailurePreservingProgress(
              dispatch,
              '本轮已完成转写超过可完整提交的长度。为避免静默丢失内容，没有生成新建议；原来的结果保持不变。请分成两轮继续聊。'
            );
            return;
          case 'rejected_context_budget':
            dispatchVoiceFailurePreservingProgress(
              dispatch,
              '原背景、所选草稿和本轮转写合计超过可安全提交的长度，因此没有生成新建议；原来的结果保持不变。请缩短背景或分成两轮继续聊。'
            );
            return;
          case 'failed':
            dispatchVoiceFailurePreservingProgress(
              dispatch,
              errorMessage(
                outcome.error,
                '更新建议失败，原来的结果没有变化。你可以重新开始语音。'
              )
            );
            return;
          case 'refined':
            processedTurnIdsRef.current.clear();
            approvedTurnsRef.current = [];
            dispatch({ type: 'reset', maxSessionSeconds: maxSecondsRef.current });
            dispatch({ type: 'phase', phase: 'completed' });
            onRefined(outcome.result);
        }
      } finally {
        if (refineController && refineAbortRef.current === refineController) {
          refineAbortRef.current = null;
        }
        finalizationInFlightRef.current = false;
      }
    },
    [abortRefinement, apiClient, onRefined, originalRequest, selectedDraft, stopSession]
  );

  finalizationHandlerRef.current = finalizeSession;

  const end = useCallback(
    async (): Promise<void> => finalizeSession('manual'),
    [finalizeSession]
  );

  const close = useCallback(() => {
    operationRef.current += 1;
    finalizationInFlightRef.current = false;
    abortRefinement();
    void stopSession();
    processedTurnIdsRef.current.clear();
    approvedTurnsRef.current = [];
    if (mountedRef.current) {
      dispatch({ type: 'reset', maxSessionSeconds: capabilities.maxSessionSeconds });
    }
  }, [abortRefinement, capabilities.maxSessionSeconds, stopSession]);

  useEffect(() => {
    mountedRef.current = true;
    const onPageHide = () => {
      operationRef.current += 1;
      finalizationInFlightRef.current = false;
      abortRefinement();
      clearTimer();
      closeController();
      void releaseLease(true);
      processedTurnIdsRef.current.clear();
      approvedTurnsRef.current = [];
      if (mountedRef.current) {
        dispatch({ type: 'reset', maxSessionSeconds: maxSecondsRef.current });
        dispatch({ type: 'phase', phase: 'ended' });
      }
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pagehide', onPageHide);
      operationRef.current += 1;
      finalizationInFlightRef.current = false;
      abortRefinement();
      clearTimer();
      closeController();
      void releaseLease(true);
      processedTurnIdsRef.current.clear();
      approvedTurnsRef.current = [];
    };
  }, [abortRefinement, clearTimer, closeController, releaseLease]);

  return {
    state,
    start,
    retry,
    toggleMute,
    interrupt,
    end,
    close
  };
}
