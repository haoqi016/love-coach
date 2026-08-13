import {
  GuidanceRequestSchema,
  toGuidanceRequestWithVoiceRefinement,
  VoiceContextTokenSchema,
  VoiceSessionResponseSchema
} from '@alc/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createVoiceCoachOutputGuardrail,
  loadRealtimeModuleAfterMedia,
  mapRealtimeTransportEvent,
  realtimeConnectionOptionsFromSession,
  VOICE_OUTPUT_GUARDRAIL_DEBOUNCE_CHARACTERS,
  VOICE_TURN_DETECTION_CONFIG
} from './realtime-controller';
import type { VoiceRealtimeController } from './realtime-controller';
import {
  buildVoiceRefinementNotes,
  canRequestApprovedRealtimeResponse,
  classifyDeletedConversationItemAck,
  classifyRealtimeSpeechStart,
  classifyCompletedVoiceTurn,
  clearSuppressedItemDeleteAckTimeout,
  clearSuppressedItemDeleteAckTimeouts,
  clearSuppressedItemTranscriptTerminalTimeout,
  clearSuppressedItemTranscriptTerminalTimeouts,
  createSessionAfterPreviousLeaseEnds,
  endVoiceLeaseWithBoundedRetry,
  isRealtimeEventFromCurrentOperation,
  dispatchVoiceFailurePreservingProgress,
  muteBeforeTurnGate,
  phaseAfterRealtimeBoundary,
  prepareVoiceFinalization,
  prepareControllerBeforeCreatingSession,
  RealtimeTurnItemGuard,
  reduceRealtimeResponseLifecycle,
  requestResponseAfterSafetyAllow,
  runPreparedVoiceFinalization,
  shouldFinalizeAfterAllowedTurn,
  shouldBlockManualVoiceFinalization,
  shouldUnmuteAfterInterruption,
  startSuppressedItemDeleteAckTimeout,
  startSuppressedItemTranscriptTerminalTimeout,
  SUPPRESSED_ITEM_DELETE_ACK_TIMEOUT_MS,
  SUPPRESSED_ITEM_TRANSCRIPT_TERMINAL_TIMEOUT_MS,
  shouldIgnoreRealtimeEventDuringFinalization,
  tryBeginVoiceFinalization,
  voiceFinalizationDecision,
  voiceSessionRequestFromSelection
} from './useRealtimeVoice';

class FakeRealtimeController implements VoiceRealtimeController {
  public readonly calls: string[] = [];

  public async prepare(): Promise<void> {
    this.calls.push('prepare');
  }

  public async connect(): Promise<void> {
    this.calls.push('connect');
  }

  public mute(muted: boolean): void {
    this.calls.push(`mute:${String(muted)}`);
  }

  public interrupt(): void {
    this.calls.push('interrupt');
  }

  public requestResponse(): void {
    this.calls.push('response.create');
  }

  public deleteConversationItem(itemId: string): void {
    this.calls.push(`conversation.item.delete:${itemId}`);
  }

  public close(): void {
    this.calls.push('close');
  }
}

const voiceOriginalRequest = GuidanceRequestSchema.parse({
  conversationText:
    '我：最近工作还顺利吗？周末想不想休息一下？\n对方：刚忙完一个项目，终于能休息了，可能会去喝杯咖啡。',
  relationshipStage: 'getting_to_know',
  goal: 'invite_to_meet',
  userTone: 'warm',
  analysisModelId: 'auto',
  context: '我们刚认识不久，希望邀请自然一点。'
});

const voiceSelectedDraft = '周末有空的话，要不要一起去喝杯咖啡？';

describe('Realtime transport event mapping', () => {
  it('stops every acquired microphone track when the SDK preload fails', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }, { stop }]
    } as unknown as MediaStream;
    let retained: MediaStream | undefined;

    await expect(
      loadRealtimeModuleAfterMedia(
        async () => stream,
        (value) => {
          retained = value;
        },
        async () => {
          throw new Error('SDK preload failed');
        }
      )
    ).rejects.toThrow('SDK preload failed');

    expect(retained).toBe(stream);
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('stops late microphone permission immediately when the panel was already closed', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }, { stop }]
    } as unknown as MediaStream;
    const loadModule = vi.fn<() => Promise<object>>().mockResolvedValue({});
    const retainMedia = vi.fn<(value: MediaStream) => void>();

    await expect(
      loadRealtimeModuleAfterMedia(
        async () => stream,
        retainMedia,
        loadModule,
        () => true
      )
    ).rejects.toThrow('cancelled');

    expect(stop).toHaveBeenCalledTimes(2);
    expect(retainMedia).not.toHaveBeenCalled();
    expect(loadModule).not.toHaveBeenCalled();
  });

  it('maps completed user transcription and never accepts missing text', () => {
    expect(
      mapRealtimeTransportEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item-1',
        transcript: '我想说得更自然一些。'
      })
    ).toEqual({
      type: 'user_transcript_completed',
      itemId: 'item-1',
      transcript: '我想说得更自然一些。'
    });
    expect(
      mapRealtimeTransportEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item-2',
        transcript: '   '
      })
    ).toEqual({ type: 'transcription_failed', itemId: 'item-2' });
  });

  it('maps item-aware speech boundaries, deletion acks, subtitles, and response identity/status', () => {
    expect(
      mapRealtimeTransportEvent({
        type: 'input_audio_buffer.speech_started',
        item_id: 'item-1'
      })
    ).toEqual({ type: 'speech_started', itemId: 'item-1' });
    expect(
      mapRealtimeTransportEvent({
        type: 'input_audio_buffer.speech_stopped',
        item_id: 'item-1'
      })
    ).toEqual({ type: 'speech_stopped', itemId: 'item-1' });
    expect(
      mapRealtimeTransportEvent({
        type: 'conversation.item.deleted',
        item_id: 'item-2'
      })
    ).toEqual({ type: 'user_item_deleted', itemId: 'item-2' });
    expect(
      mapRealtimeTransportEvent({
        type: 'response.output_audio_transcript.delta',
        delta: '我们先说说你的目标。'
      })
    ).toEqual({
      type: 'assistant_transcript_delta',
      delta: '我们先说说你的目标。'
    });
    expect(
      mapRealtimeTransportEvent({
        type: 'response.created',
        response: { id: 'resp-current', status: 'in_progress' }
      })
    ).toEqual({
      type: 'response_started',
      responseId: 'resp-current'
    });
    expect(
      mapRealtimeTransportEvent({
        type: 'response.done',
        response: {
          id: 'resp-current',
          status: 'incomplete',
          status_details: {
            type: 'incomplete',
            reason: 'max_output_tokens'
          }
        }
      })
    ).toEqual({
      type: 'response_completed',
      responseId: 'resp-current',
      status: 'incomplete',
      statusDetails: {
        type: 'incomplete',
        reason: 'max_output_tokens'
      }
    });
    expect(mapRealtimeTransportEvent({ type: 'response.done' })).toEqual({
      type: 'error',
      message: '语音回复终态信息不完整，本次连接已经停止。'
    });
  });

  it('uses server-authorized model, voice, transcription, and instructions instead of labels', () => {
    const session = VoiceSessionResponseSchema.parse({
      clientSecret: 'ek_test_secret',
      expiresAt: 1_786_300_000,
      sessionLeaseId: 'lease_1234567890abcdef',
      model: 'gpt-realtime-2.1-mini',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      voice: 'marin',
      sessionInstructions: '只围绕已验证结果澄清目标、感受与边界。',
      modelLabel: 'Realtime mini（语音）',
      voiceLabel: '温暖自然声线',
      maxSessionSeconds: 300
    });
    const onEvent = vi.fn();

    expect(realtimeConnectionOptionsFromSession(session, onEvent)).toEqual({
      clientSecret: 'ek_test_secret',
      model: 'gpt-realtime-2.1-mini',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      voice: 'marin',
      sessionInstructions: '只围绕已验证结果澄清目标、感受与边界。',
      onEvent
    });
  });
});

describe('Realtime response safety ordering', () => {
  it('splits long transcripts without loss and ignores duplicate turn events', () => {
    const longTranscript = `我还担心${'太快'.repeat(160)}`;
    const built = buildVoiceRefinementNotes([
      { id: 'turn-1', transcript: '  我希望自然一点。  ' },
      { id: 'turn-1', transcript: '重复事件不应再次进入建议。' },
      { id: 'turn-2', transcript: longTranscript }
    ]);

    expect(built.overflow).toBe(false);
    expect(built.notes).toHaveLength(2);
    expect(built.notes.map((note) => note.value).join('')).toBe(
      `我希望自然一点。${longTranscript}`
    );
    expect(built.notes.every((note) => note.value.length <= 240)).toBe(true);
  });

  it('packs mixed short and long turns globally without a false overflow', () => {
    const turns = [
      ...Array.from({ length: 7 }, (_, index) => ({
        id: `short-${index}`,
        transcript: String(index).repeat(130)
      })),
      { id: 'long', transcript: '长'.repeat(241) }
    ];
    const built = buildVoiceRefinementNotes(turns);

    expect(built.overflow).toBe(false);
    expect(built.notes).toHaveLength(5);
    expect(built.notes.map((note) => note.value).join('')).toBe(
      turns.map((turn) => turn.transcript).join('')
    );
  });

  it('rejects an oversized transcript set instead of silently dropping later content', () => {
    const built = buildVoiceRefinementNotes([
      { id: 'turn-1', transcript: '内容'.repeat(961) }
    ]);

    expect(built.notes).toHaveLength(8);
    expect(built.overflow).toBe(true);
    expect(
      voiceFinalizationDecision('timeout', 'safety_checking', [
        { id: 'turn-1', transcript: '内容'.repeat(961) }
      ])
    ).toBe('reject_oversized_transcript');
  });

  it('uses completed safe turns at timeout but drops a pending partial turn', () => {
    const safeTurns = [
      { id: 'turn-1', transcript: '我想表达好感，但不想让对方有压力。' }
    ];

    expect(voiceFinalizationDecision('manual', 'transcribing', safeTurns)).toBe(
      'blocked'
    );
    expect(voiceFinalizationDecision('manual', 'safety_checking', safeTurns)).toBe(
      'blocked'
    );
    expect(voiceFinalizationDecision('timeout', 'safety_checking', safeTurns)).toBe(
      'refine'
    );
    expect(voiceFinalizationDecision('timeout', 'transcribing', [])).toBe(
      'end_without_refinement'
    );
  });

  it('admits only one finalization path when manual end and timeout race', () => {
    const lock = { current: false };
    const finalize = vi.fn<(trigger: 'manual' | 'timeout') => void>();

    if (tryBeginVoiceFinalization(lock)) finalize('manual');
    if (tryBeginVoiceFinalization(lock)) finalize('timeout');

    expect(finalize).toHaveBeenCalledOnce();
    expect(finalize).toHaveBeenCalledWith('manual');
  });

  it('finalizes by packed note capacity rather than raw turn count', () => {
    expect(
      shouldFinalizeAfterAllowedTurn([
        { id: 'short', transcript: '短'.repeat(100) }
      ])
    ).toBe(false);
    expect(
      shouldFinalizeAfterAllowedTurn([
        { id: 'full', transcript: '字'.repeat(1_681) }
      ])
    ).toBe(true);
  });

  it('builds a second-round session request from the refreshed token and newly selected draft', () => {
    const freshToken = VoiceContextTokenSchema.parse('n'.repeat(40));
    const nextDraft = '第二轮想继续打磨的新草稿。';

    expect(voiceSessionRequestFromSelection(freshToken, nextDraft)).toEqual({
      voiceContextToken: freshToken,
      selectedDraft: nextDraft,
      adultConfirmed: true
    });
  });

  it('ends a zero-turn timeout without calling the paid refinement API', async () => {
    const stopSession = vi.fn(async () => undefined);
    const refine = vi.fn(async () => {
      throw new Error('refine must not run');
    });
    const prepared = prepareVoiceFinalization(
      'timeout',
      'transcribing',
      [],
      voiceOriginalRequest,
      voiceSelectedDraft
    );

    await expect(
      runPreparedVoiceFinalization({
        prepared,
        originalRequest: voiceOriginalRequest,
        selectedDraft: voiceSelectedDraft,
        stopSession,
        refine
      })
    ).resolves.toEqual({ status: 'ended_without_refinement' });
    expect(stopSession).toHaveBeenCalledOnce();
    expect(refine).not.toHaveBeenCalled();
  });

  it('keeps the previous result untouched when the final refinement request fails', async () => {
    const stopSession = vi.fn(async () => undefined);
    const failure = new Error('provider unavailable');
    const refine = vi.fn(async () => {
      throw failure;
    });
    const prepared = prepareVoiceFinalization(
      'manual',
      'listening',
      [{ id: 'turn-1', transcript: '我想邀请自然一点，不希望给对方压力。' }],
      voiceOriginalRequest,
      voiceSelectedDraft
    );

    const outcome = await runPreparedVoiceFinalization({
      prepared,
      originalRequest: voiceOriginalRequest,
      selectedDraft: voiceSelectedDraft,
      stopSession,
      refine
    });

    expect(outcome).toEqual({ status: 'failed', error: failure });
    expect(stopSession).toHaveBeenCalledOnce();
    expect(refine).toHaveBeenCalledOnce();
  });

  it('preflights a legal canonical prior round with a 2000-character user base', () => {
    const accumulatedRequest = toGuidanceRequestWithVoiceRefinement({
      originalRequest: GuidanceRequestSchema.parse({
        ...voiceOriginalRequest,
        context: '旧'.repeat(2_000)
      }),
      notes: Array.from({ length: 8 }, (_, index) => ({
        kind: 'other' as const,
        value: `${index}${'历'.repeat(239)}`,
        confirmed: true
      })),
      selectedDraft: '草'.repeat(600)
    });
    const prepared = prepareVoiceFinalization(
      'manual',
      'listening',
      [{ id: 'turn-1', transcript: '新'.repeat(240) }],
      accumulatedRequest,
      voiceSelectedDraft
    );

    expect(prepared.decision).toBe('refine');
  });

  it('keeps a normal maximum eight-turn round within the internal refinement budget', () => {
    const initialMaximumRequest = GuidanceRequestSchema.parse({
      ...voiceOriginalRequest,
      context: '背景'.repeat(1_000)
    });
    const prepared = prepareVoiceFinalization(
      'manual',
      'listening',
      Array.from({ length: 8 }, (_, index) => ({
        id: `turn-${index + 1}`,
        transcript: '补充'.repeat(120)
      })),
      initialMaximumRequest,
      '草稿'.repeat(300)
    );

    expect(prepared.notes).toHaveLength(8);
    expect(prepared.decision).toBe('refine');
  });

  it('ignores late events from the stopped session while refinement is in flight', () => {
    const lateEvents = [
      { type: 'interrupted' },
      {
        type: 'response_completed',
        responseId: 'resp-old',
        status: 'cancelled',
        statusDetails: { type: 'cancelled', reason: 'client_cancelled' }
      },
      { type: 'assistant_transcript_delta', delta: '迟到字幕' }
    ];
    const handled: string[] = [];

    for (const event of lateEvents) {
      if (!shouldIgnoreRealtimeEventDuringFinalization(true)) {
        handled.push(event.type);
      }
    }

    expect(handled).toEqual([]);
    expect(shouldIgnoreRealtimeEventDuringFinalization(false)).toBe(false);
    expect(isRealtimeEventFromCurrentOperation(4, 5)).toBe(false);
    expect(isRealtimeEventFromCurrentOperation(5, 5)).toBe(true);
  });

  it('uses a low-latency output guardrail for unsafe spoken advice', async () => {
    const guardrail = createVoiceCoachOutputGuardrail();
    const safe = await guardrail.execute({
      agentOutput: '先问一个低压力的问题，不替对方下结论。'
    } as Parameters<typeof guardrail.execute>[0]);
    const unsafe = await guardrail.execute({
      agentOutput: '她喜欢你的概率是 85%，照我说的做保证能挽回。'
    } as Parameters<typeof guardrail.execute>[0]);

    expect(VOICE_OUTPUT_GUARDRAIL_DEBOUNCE_CHARACTERS).toBe(12);
    expect(VOICE_TURN_DETECTION_CONFIG).toEqual({
      type: 'semantic_vad',
      createResponse: false,
      eagerness: 'low',
      interruptResponse: false
    });
    expect(safe.tripwireTriggered).toBe(false);
    expect(unsafe.tripwireTriggered).toBe(true);
  });

  it('mutes as soon as speech stops, before transcription and turn safety', () => {
    const controller = new FakeRealtimeController();

    muteBeforeTurnGate(controller, () => controller.calls.push('state:muted'));
    controller.calls.push('transcription:completed');
    controller.calls.push('turn-safety:start');

    expect(controller.calls).toEqual([
      'mute:true',
      'state:muted',
      'transcription:completed',
      'turn-safety:start'
    ]);
  });

  it('keeps the microphone muted while an approved response is still pending', () => {
    const controller = new FakeRealtimeController();
    controller.calls.push('turn-safety:allow');

    requestResponseAfterSafetyAllow(controller, () => {
      controller.calls.push('state:requested');
    });

    expect(controller.calls).toEqual([
      'turn-safety:allow',
      'response.create',
      'state:requested'
    ]);
  });

  it('returns to listening when the user starts speaking or interrupts a reply', () => {
    expect(
      phaseAfterRealtimeBoundary('speaking', { type: 'speech_started', itemId: 'item-1' })
    ).toBe('listening');
    expect(
      phaseAfterRealtimeBoundary('thinking', { type: 'interrupted' })
    ).toBe('listening');
    expect(
      phaseAfterRealtimeBoundary('listening', { type: 'speech_stopped', itemId: 'item-1' })
    ).toBe('transcribing');
    expect(shouldUnmuteAfterInterruption(false, false)).toBe(true);
    expect(shouldUnmuteAfterInterruption(true, false)).toBe(false);
    expect(shouldUnmuteAfterInterruption(false, true)).toBe(false);
  });

  it('keeps queued echo or noise muted while the previous turn gate is closed', () => {
    expect(classifyRealtimeSpeechStart(false, true, 'item-1', 'item-1')).toBe(
      'wait_for_gate'
    );
    expect(classifyRealtimeSpeechStart(false, true, 'item-2', 'item-1')).toBe(
      'suppress_item'
    );
    expect(classifyRealtimeSpeechStart(true, true, 'item-2', 'item-1')).toBe(
      'unsafe_overlap'
    );
    expect(classifyRealtimeSpeechStart(true, false, 'item-2', null)).toBe(
      'interrupt_response'
    );
    expect(classifyRealtimeSpeechStart(false, false, 'item-1', null)).toBe('listen');
  });

  it('waits for two suppressed items to be deleted, then requests one response after the last out-of-order ack', () => {
    const guard = new RealtimeTurnItemGuard();
    const controller = new FakeRealtimeController();
    let approvedResponseWaiting = true;
    const requestIfReady = () => {
      if (!canRequestApprovedRealtimeResponse(approvedResponseWaiting, guard)) return;
      approvedResponseWaiting = false;
      controller.requestResponse();
    };

    expect(guard.speechStarted('item-a', false, false)).toBe('listen');
    expect(guard.speechStopped('item-a', false, false)).toBe('close_gate');
    expect(guard.transcriptDisposition('item-a')).toBe('check');
    expect(guard.speechStarted('item-a', false, true)).toBe('wait_for_gate');
    expect(guard.speechStarted('item-b', false, true)).toBe('suppress_item');
    expect(guard.speechStarted('item-c', false, true)).toBe('suppress_item');
    expect(guard.hasPendingSuppressedItems).toBe(true);
    requestIfReady();
    expect(controller.calls).not.toContain('response.create');
    expect(guard.requestSuppressedItemDeletion('item-b')).toBe('delete_item');
    expect(guard.requestSuppressedItemDeletion('item-b')).toBe('none');
    expect(guard.requestSuppressedItemDeletion('item-c')).toBe('delete_item');
    expect(guard.transcriptDisposition('item-b')).toBe('discard');
    expect(guard.transcriptDisposition('item-c')).toBe('discard');

    expect(classifyDeletedConversationItemAck(guard, 'item-c')).toBe('expected');
    requestIfReady();
    expect(controller.calls).not.toContain('response.create');
    expect(guard.hasPendingSuppressedItems).toBe(true);
    expect(classifyDeletedConversationItemAck(guard, 'item-c')).toBe('duplicate');
    requestIfReady();
    expect(controller.calls).not.toContain('response.create');

    expect(classifyDeletedConversationItemAck(guard, 'item-b')).toBe('expected');
    requestIfReady();
    expect(guard.hasPendingSuppressedItems).toBe(false);
    requestIfReady();
    expect(controller.calls.filter((call) => call === 'response.create')).toHaveLength(1);
    expect(classifyDeletedConversationItemAck(guard, 'item-b')).toBe('duplicate');
    requestIfReady();
    expect(controller.calls.filter((call) => call === 'response.create')).toHaveLength(1);
    expect(guard.transcriptDisposition('item-b')).toBe('discard');
  });

  it('classifies a deleted ack for an untracked item as fail-closed input', () => {
    const guard = new RealtimeTurnItemGuard();
    expect(classifyDeletedConversationItemAck(guard, 'unexpected-item')).toBe(
      'unexpected'
    );
  });

  it('times out each suppressed-item deletion after four seconds and clears timers on ack or cleanup', () => {
    vi.useFakeTimers();
    try {
      const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
      const timedOutItems: string[] = [];

      startSuppressedItemDeleteAckTimeout(timeouts, 'item-b', (itemId) => {
        timedOutItems.push(itemId);
      });
      expect(SUPPRESSED_ITEM_DELETE_ACK_TIMEOUT_MS).toBe(4_000);
      vi.advanceTimersByTime(3_999);
      expect(timedOutItems).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(timedOutItems).toEqual(['item-b']);
      expect(timeouts.size).toBe(0);

      startSuppressedItemDeleteAckTimeout(timeouts, 'item-c', (itemId) => {
        timedOutItems.push(itemId);
      });
      expect(clearSuppressedItemDeleteAckTimeout(timeouts, 'item-c')).toBe(true);
      startSuppressedItemDeleteAckTimeout(timeouts, 'item-d', (itemId) => {
        timedOutItems.push(itemId);
      });
      clearSuppressedItemDeleteAckTimeouts(timeouts);
      vi.advanceTimersByTime(4_000);
      expect(timedOutItems).toEqual(['item-b']);
      expect(timeouts.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails bounded when a suppressed item never emits a transcript terminal event', () => {
    vi.useFakeTimers();
    try {
      const guard = new RealtimeTurnItemGuard();
      const timeouts = new Map<string, ReturnType<typeof setTimeout>>();
      const timedOutItems: string[] = [];

      expect(guard.speechStarted('item-a', false, false)).toBe('listen');
      expect(guard.speechStopped('item-a', false, false)).toBe('close_gate');
      expect(guard.speechStarted('item-b', false, true)).toBe('suppress_item');
      expect(guard.isAwaitingTranscriptTerminal('item-b')).toBe(true);
      startSuppressedItemTranscriptTerminalTimeout(timeouts, 'item-b', (itemId) => {
        timedOutItems.push(itemId);
      });

      expect(SUPPRESSED_ITEM_TRANSCRIPT_TERMINAL_TIMEOUT_MS).toBe(10_000);
      vi.advanceTimersByTime(9_999);
      expect(timedOutItems).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(timedOutItems).toEqual(['item-b']);
      expect(timeouts.size).toBe(0);

      startSuppressedItemTranscriptTerminalTimeout(timeouts, 'item-c', (itemId) => {
        timedOutItems.push(itemId);
      });
      expect(clearSuppressedItemTranscriptTerminalTimeout(timeouts, 'item-c')).toBe(
        true
      );
      startSuppressedItemTranscriptTerminalTimeout(timeouts, 'item-d', (itemId) => {
        timedOutItems.push(itemId);
      });
      clearSuppressedItemTranscriptTerminalTimeouts(timeouts);
      vi.advanceTimersByTime(10_000);
      expect(timedOutItems).toEqual(['item-b']);
      expect(timeouts.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a connection failure without dispatching a reset first', () => {
    const actions: Array<{ type: string; message?: string }> = [];
    dispatchVoiceFailurePreservingProgress((action) => actions.push(action), '连接中断');
    expect(actions).toEqual([{ type: 'error', message: '连接中断' }]);
  });

  it('fails closed when a different item appears after response creation is already pending', () => {
    const guard = new RealtimeTurnItemGuard();
    expect(guard.speechStarted('item-a', false, false)).toBe('listen');
    expect(guard.speechStopped('item-a', false, false)).toBe('close_gate');
    expect(guard.speechStarted('item-b', true, true)).toBe('unsafe_overlap');
    expect(guard.transcriptDisposition('unknown-item')).toBe('unsafe_overlap');
  });

  it('keeps a queued approved response pending when the cancelled response completes first', () => {
    let lifecycle: Parameters<typeof reduceRealtimeResponseLifecycle>[0] = {
      pending: false,
      active: true,
      activeResponseId: 'resp-old'
    };
    lifecycle = reduceRealtimeResponseLifecycle(lifecycle, { type: 'cancelled' });
    lifecycle = reduceRealtimeResponseLifecycle(lifecycle, { type: 'approved' });

    const staleCompletion = reduceRealtimeResponseLifecycle(lifecycle, {
      type: 'completed',
      responseId: 'resp-old',
      status: 'cancelled'
    });
    expect(staleCompletion).toEqual({
      pending: true,
      active: false,
      activeResponseId: null,
      action: 'none'
    });

    const newStart = reduceRealtimeResponseLifecycle(staleCompletion, {
      type: 'started',
      responseId: 'resp-new'
    });
    expect(newStart).toEqual({
      pending: false,
      active: true,
      activeResponseId: 'resp-new',
      action: 'activate'
    });

    const lateOldFailure = reduceRealtimeResponseLifecycle(newStart, {
      type: 'completed',
      responseId: 'resp-old',
      status: 'failed'
    });
    expect(lateOldFailure).toEqual({ ...newStart, action: 'none' });

    expect(
      reduceRealtimeResponseLifecycle(lateOldFailure, {
        type: 'completed',
        responseId: 'resp-new',
        status: 'completed'
      })
    ).toEqual({
      pending: false,
      active: false,
      activeResponseId: null,
      action: 'complete'
    });
  });

  it('fails closed only when the matching active response ends non-completed', () => {
    const active = {
      pending: false,
      active: true,
      activeResponseId: 'resp-current'
    };

    expect(
      reduceRealtimeResponseLifecycle(active, {
        type: 'completed',
        responseId: 'resp-current',
        status: 'incomplete'
      })
    ).toEqual({
      pending: false,
      active: false,
      activeResponseId: null,
      action: 'terminal_error'
    });
  });

  it('blocks an immediate manual end synchronously after speech stops, before React commits the phase', () => {
    const guard = new RealtimeTurnItemGuard();
    expect(guard.speechStarted('item-latest', false, false)).toBe('listen');
    expect(guard.speechStopped('item-latest', false, false)).toBe('close_gate');
    expect(guard.hasPendingActiveItem).toBe(true);

    expect(
      shouldBlockManualVoiceFinalization({
        phase: 'listening',
        safetyInFlight: false,
        turnGateClosed: true,
        hasPendingActiveItem: guard.hasPendingActiveItem,
        hasPendingSuppressedItems: guard.hasPendingSuppressedItems,
        approvedResponseInFlight: false
      })
    ).toBe(true);

    expect(guard.markActiveItemChecked('item-latest')).toBe(true);
    expect(
      shouldBlockManualVoiceFinalization({
        phase: 'thinking',
        safetyInFlight: false,
        turnGateClosed: true,
        hasPendingActiveItem: guard.hasPendingActiveItem,
        hasPendingSuppressedItems: guard.hasPendingSuppressedItems,
        approvedResponseInFlight: true
      })
    ).toBe(false);
  });

  it('still rejects a real second transcript while safety or a response is in flight', () => {
    const processed = new Set(['turn-1']);

    expect(classifyCompletedVoiceTurn('turn-1', processed, true)).toBe('duplicate');
    expect(classifyCompletedVoiceTurn('turn-2', processed, true)).toBe('overlap');
    expect(classifyCompletedVoiceTurn('turn-2', processed, false)).toBe('check');
  });

  it('waits for the previous lease release before creating a retry session', async () => {
    const calls: string[] = [];
    let finishRelease: (() => void) | undefined;
    const release = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });

    const resultPromise = createSessionAfterPreviousLeaseEnds(
      async () => {
        calls.push('end:start');
        await release;
        calls.push('end:done');
      },
      async () => {
        calls.push('session:create');
        return 'new-session';
      }
    );
    await Promise.resolve();
    expect(calls).toEqual(['end:start']);

    finishRelease?.();
    await expect(resultPromise).resolves.toBe('new-session');
    expect(calls).toEqual(['end:start', 'end:done', 'session:create']);
  });

  it('does not request microphone permission after start was cancelled during lease release', async () => {
    let finishRelease: (() => void) | undefined;
    let active = true;
    const release = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const createSession = vi.fn<() => Promise<string>>().mockResolvedValue('must-not-run');
    const result = createSessionAfterPreviousLeaseEnds(
      async () => release,
      createSession,
      () => active
    );

    active = false;
    finishRelease?.();

    await expect(result).rejects.toThrow('cancelled');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('prepares microphone and SDK before requesting the short-lived client secret', async () => {
    const controller = new FakeRealtimeController();

    const result = await prepareControllerBeforeCreatingSession(controller, async () => {
      controller.calls.push('session:create');
      return 'short-lived-secret';
    });

    expect(result).toBe('short-lived-secret');
    expect(controller.calls).toEqual(['prepare', 'session:create']);
  });

  it('retries a lost lease-end response within a fixed bound', async () => {
    const endLease = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('lost 204'))
      .mockResolvedValueOnce(undefined);

    await expect(endVoiceLeaseWithBoundedRetry(endLease, 2)).resolves.toBe(true);
    expect(endLease).toHaveBeenCalledTimes(2);
  });
});
