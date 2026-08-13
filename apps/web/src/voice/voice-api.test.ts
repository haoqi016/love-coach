import {
  GuidanceRequestSchema,
  VoiceContextTokenSchema,
  VoiceSessionLeaseIdSchema
} from '@alc/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as VoiceApiModule from './voice-api';

async function loadVoiceApi(): Promise<typeof VoiceApiModule> {
  vi.resetModules();
  vi.stubEnv('VITE_STATIC_DEMO', '');
  return import('./voice-api');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voice control API', () => {
  it('loads only public feature capability labels', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          enabled: true,
          modelLabel: 'Realtime mini（语音）',
          voiceLabel: '温暖自然声线',
          maxSessionSeconds: 300
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { fetchVoiceCapabilities } = await loadVoiceApi();

    await expect(fetchVoiceCapabilities()).resolves.toEqual({
      enabled: true,
      modelLabel: 'Realtime mini（语音）',
      voiceLabel: '温暖自然声线',
      maxSessionSeconds: 300
    });
  });

  it('uses the opaque guidance token and retains the lease only in the response object', async () => {
    const voiceContextToken = VoiceContextTokenSchema.parse('v'.repeat(40));
    const responseBody = {
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
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { createVoiceSession } = await loadVoiceApi();

    const selectedDraft = '周末有空的话，要不要一起去喝杯咖啡？';
    const result = await createVoiceSession({
      voiceContextToken,
      adultConfirmed: true,
      selectedDraft
    });

    expect(result).toEqual(responseBody);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/voice/session');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      voiceContextToken,
      selectedDraft,
      adultConfirmed: true
    });
  });

  it('returns the refreshed voice token and the exact next guidance request after refinement', async () => {
    const refreshedToken = 'n'.repeat(40);
    const guidance = {
      summary: '语音补充后，重点是轻松表达邀请，并给对方选择空间。',
      summaryEvidence: [{ kind: 'quote', quote: '周末可能会去喝杯咖啡' }],
      mutualTopics: ['咖啡'],
      mutualTopicEvidence: [[{ kind: 'quote', quote: '可能会去喝杯咖啡' }]],
      openLoops: [],
      openLoopEvidence: [],
      interactionPattern: {
        reciprocity: 'balanced',
        pacing: 'steady',
        observation: '双方都有回应。',
        evidence: [{ kind: 'quote', quote: '刚忙完一个项目' }]
      },
      uncertainties: ['未知：对方本周末的具体安排。'],
      recommendedDepth: 'personal',
      topicBridges: [],
      messageOptions: [
        {
          style: 'warm',
          text: '周末有空的话，要不要一起去喝杯咖啡？',
          why: '表达清楚，同时保留选择空间。',
          watchFor: '尊重对方的回应节奏。',
          evidence: [{ kind: 'advice' }]
        }
      ],
      risk: {
        level: 'low',
        categories: [],
        notice: '未发现需要中止普通建议的风险。'
      },
      nextStep: '按自己的语气确认后再决定是否发送。',
      nextStepEvidence: [{ kind: 'advice' }]
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(guidance), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-ALC-Voice-Context-Token': refreshedToken,
          'X-ALC-Guidance-Source': 'remote',
          'X-ALC-Guidance-Provider': 'openai-compatible:event-model'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { refineGuidanceWithVoice } = await loadVoiceApi();
    const originalRequest = GuidanceRequestSchema.parse({
      conversationText:
        '我：最近工作还顺利吗？周末想不想休息一下？\n对方：刚忙完一个项目，终于能休息了，周末可能会去喝杯咖啡。',
      relationshipStage: 'getting_to_know',
      goal: 'invite_to_meet',
      userTone: 'warm',
      analysisModelId: 'auto'
    });
    const selectedDraft = '周末有空的话，要不要一起去喝杯咖啡？';

    const result = await refineGuidanceWithVoice({
      originalRequest,
      notes: [
        {
          kind: 'other',
          value: '我希望邀请自然一点，也不想给对方压力。',
          confirmed: true
        }
      ],
      selectedDraft
    });

    expect(result.guidance).toEqual(guidance);
    expect(result.voiceContextToken).toBe(refreshedToken);
    expect(result.nextRequest).toMatchObject({
      ...originalRequest,
      context: expect.stringContaining('我希望邀请自然一点，也不想给对方压力。')
    });
    expect(result.nextRequest.context).toContain(selectedDraft);
  });

  it('binds turn safety and end requests to the same lease', async () => {
    const sessionLeaseId = VoiceSessionLeaseIdSchema.parse('lease_1234567890abcdef');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            action: 'allow',
            reason: 'low',
            risk: {
              level: 'low',
              categories: [],
              notice: '可以继续普通沟通复盘。'
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { checkVoiceTurnSafety, endVoiceSession } = await loadVoiceApi();

    await expect(
      checkVoiceTurnSafety({
        sessionLeaseId,
        transcript: '我想先把自己的担心说清楚。',
        adultConfirmed: true
      })
    ).resolves.toMatchObject({ action: 'allow', reason: 'low' });
    await endVoiceSession({ sessionLeaseId }, { keepalive: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/voice/turn-safety');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        sessionLeaseId,
        transcript: '我想先把自己的担心说清楚。',
        adultConfirmed: true
      })
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/voice/end',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({ sessionLeaseId })
      })
    ]);
  });

  it('propagates caller cancellation to an in-flight paid refinement request', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        const rejectAborted = () =>
          reject(new DOMException('Request aborted.', 'AbortError'));
        if (observedSignal?.aborted) {
          rejectAborted();
          return;
        }
        observedSignal?.addEventListener('abort', rejectAborted, { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { refineGuidanceWithVoice } = await loadVoiceApi();
    const controller = new AbortController();
    const pending = refineGuidanceWithVoice(
      {
        originalRequest: GuidanceRequestSchema.parse({
          conversationText:
            '我：最近工作还顺利吗？周末想不想休息一下？\n对方：刚忙完一个项目，终于能休息了，可能会去喝杯咖啡。',
          relationshipStage: 'getting_to_know',
          goal: 'keep_conversation_flowing',
          userTone: 'warm',
          analysisModelId: 'auto'
        }),
        notes: [
          {
            kind: 'goal',
            value: '我想表达关心，但不希望给对方压力。',
            confirmed: true
          }
        ],
        selectedDraft: '最近看你挺忙的，周末要不要找时间喝杯咖啡？'
      },
      { signal: controller.signal }
    );

    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow('等待时间有点久');
    expect(observedSignal?.aborted).toBe(true);
  });
});
