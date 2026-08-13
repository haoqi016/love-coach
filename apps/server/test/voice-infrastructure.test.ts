import {
  MAX_VOICE_TURN_TEXT_LENGTH,
  type TrustedVoiceContext
} from '@alc/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { RealtimeVoiceServerConfig } from '../src/config.js';
import {
  compactTrustedVoiceContext,
  createAnonymousVoiceClientId,
  signVoiceContextToken,
  verifyVoiceContextToken,
  VoiceContextTokenError
} from '../src/voice/context-token.js';
import { VoiceLeaseManager } from '../src/voice/lease-manager.js';
import { OpenAiRealtimeClient } from '../src/voice/realtime-client.js';
import type { RealtimeClientError } from '../src/voice/realtime-client.js';

const signingSecret = 'test-signing-secret-at-least-32-characters';
const trustedContext: TrustedVoiceContext = {
  summary: '双方围绕周末和咖啡展开了轻松交流。',
  uncertainties: ['对方是否希望继续这个话题仍不确定。'],
  nextStep: '先回应咖啡这个共同话题，再问一个容易回答的问题。',
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'warm',
  risk: { level: 'low', categories: [], notice: '当前未发现明显安全风险。' }
};

const realtimeConfig: RealtimeVoiceServerConfig = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'server-only-key',
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  transcriptionModel: 'gpt-4o-mini-transcribe',
  maxSessionSeconds: 300,
  maxActiveLeasesPerInstance: 2,
  maxSessionStartsPerDay: 30,
  contextSigningSecret: signingSecret
};

describe('voice context token', () => {
  it('round-trips a compact allowlisted payload and rejects tampering or expiry', () => {
    const token = signVoiceContextToken(
      trustedContext,
      signingSecret,
      'voice-coach-v2',
      1_800_000_600
    );

    expect(verifyVoiceContextToken(token, signingSecret, 1_800_000_000_000)).toEqual({
      context: trustedContext,
      promptVersion: 'voice-coach-v2',
      exp: 1_800_000_600
    });
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) throw new Error('Expected token payload.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      context: Record<string, unknown>;
      promptVersion: string;
      exp: number;
    };
    expect(Object.keys(payload).sort()).toEqual(['context', 'exp', 'promptVersion']);
    expect(Object.keys(payload.context).sort()).toEqual([
      'goal',
      'nextStep',
      'relationshipStage',
      'risk',
      'summary',
      'uncertainties',
      'userTone'
    ]);
    expect(payload.context).not.toHaveProperty('conversationText');
    expect(payload.context).not.toHaveProperty('analysisModelId');
    expect(token).not.toContain('咖啡');
    expect(() =>
      verifyVoiceContextToken(`${token.slice(0, -1)}A`, signingSecret, 1_800_000_000_000)
    ).toThrow(VoiceContextTokenError);
    expect(() =>
      verifyVoiceContextToken(token, signingSecret, 1_800_000_600_000)
    ).toThrow(VoiceContextTokenError);
  });

  it('keeps a worst-case trusted context within the opaque header contract', () => {
    const compact = compactTrustedVoiceContext({
      ...trustedContext,
      summary: '摘'.repeat(800),
      uncertainties: Array.from({ length: 8 }, () => '待'.repeat(300)),
      nextStep: '步'.repeat(600),
      selectedDraft: '话'.repeat(600),
      risk: { ...trustedContext.risk, notice: '安'.repeat(800) }
    });
    const token = signVoiceContextToken(
      compact,
      signingSecret,
      'guidance-v4',
      1_800_000_600
    );

    expect(token.length).toBeLessThanOrEqual(4_096);
    expect(verifyVoiceContextToken(token, signingSecret, 1_800_000_000_000).context).toEqual(
      compact
    );
  });

  it('creates a stable pseudonymous identifier without exposing its raw inputs', () => {
    const first = createAnonymousVoiceClientId(
      signingSecret,
      'anonymous_cookie_token_1234567890abcdef'
    );
    const second = createAnonymousVoiceClientId(
      signingSecret,
      'anonymous_cookie_token_1234567890abcdef'
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^alc_[A-Za-z0-9_-]{48}$/u);
    expect(first).not.toContain('anonymous_cookie_token');
  });
});

describe('VoiceLeaseManager', () => {
  it('enforces one active lease per client, instance capacity, expiry, end, and daily starts', () => {
    let now = Date.UTC(2026, 7, 10, 1, 0, 0);
    let id = 0;
    const manager = new VoiceLeaseManager({
      maxActiveLeases: 2,
      maxStartsPerDay: 3,
      maxSessionSeconds: 300,
      now: () => now,
      createId: () => `lease-${++id}`
    });

    const first = manager.begin('client-a');
    expect(first).toMatchObject({ allowed: true, lease: { id: 'lease-1' } });
    expect(manager.begin('client-a')).toMatchObject({
      allowed: false,
      reason: 'client_active'
    });
    const second = manager.begin('client-b');
    expect(second).toMatchObject({ allowed: true, lease: { id: 'lease-2' } });
    expect(manager.begin('client-c')).toMatchObject({
      allowed: false,
      reason: 'instance_capacity'
    });

    if (!first.allowed || !second.allowed) throw new Error('Expected test leases.');
    expect(manager.end(first.lease.id, 'wrong-client')).toBe(false);
    expect(manager.end(first.lease.id, 'client-a')).toBe(true);
    expect(manager.begin('client-c')).toMatchObject({
      allowed: true,
      lease: { id: 'lease-3' }
    });
    expect(manager.end(second.lease.id, 'client-b')).toBe(true);
    expect(manager.begin('client-d')).toMatchObject({
      allowed: false,
      reason: 'daily_budget'
    });

    now += 24 * 60 * 60 * 1_000;
    expect(manager.begin('client-d')).toMatchObject({ allowed: true });
  });

  it('prunes an expired lease', () => {
    let now = 1_800_000_000_000;
    const manager = new VoiceLeaseManager({
      maxActiveLeases: 1,
      maxStartsPerDay: 2,
      maxSessionSeconds: 60,
      now: () => now,
      createId: () => 'lease-id'
    });

    const lease = manager.begin('client-a');
    expect(lease.allowed).toBe(true);
    now += 60_000;
    expect(manager.isActive('lease-id', 'client-a')).toBe(false);
    expect(manager.begin('client-b').allowed).toBe(true);
  });

  it('keeps an ordered bounded transcript suffix and clears it on end or expiry', () => {
    let now = 1_800_000_000_000;
    let id = 0;
    const manager = new VoiceLeaseManager({
      maxActiveLeases: 1,
      maxStartsPerDay: 3,
      maxSessionSeconds: 60,
      now: () => now,
      createId: () => `lease-${++id}`
    });

    const first = manager.begin('client-a');
    if (!first.allowed) throw new Error('Expected the first lease.');
    expect(manager.approvedTranscriptSuffix(first.lease.id, 'client-a')).toBe('');
    expect(
      manager.recordApprovedTranscript(first.lease.id, 'client-a', '第一轮')
    ).toBe(true);
    expect(
      manager.recordApprovedTranscript(first.lease.id, 'client-a', '第二轮')
    ).toBe(true);
    expect(manager.approvedTranscriptSuffix(first.lease.id, 'client-a')).toBe(
      '第一轮第二轮'
    );

    const overflow = `${'前'.repeat(MAX_VOICE_TURN_TEXT_LENGTH)}末`;
    expect(
      manager.recordApprovedTranscript(first.lease.id, 'client-a', overflow)
    ).toBe(true);
    expect(manager.approvedTranscriptSuffix(first.lease.id, 'client-a')).toBe(
      overflow.slice(-MAX_VOICE_TURN_TEXT_LENGTH)
    );

    expect(manager.end(first.lease.id, 'client-a')).toBe(true);
    expect(
      manager.approvedTranscriptSuffix(first.lease.id, 'client-a')
    ).toBeUndefined();
    expect(
      manager.recordApprovedTranscript(first.lease.id, 'client-a', '不能写入')
    ).toBe(false);

    const second = manager.begin('client-b');
    if (!second.allowed) throw new Error('Expected the second lease.');
    expect(
      manager.recordApprovedTranscript(second.lease.id, 'client-b', '临时内容')
    ).toBe(true);
    now += 60_000;
    expect(
      manager.approvedTranscriptSuffix(second.lease.id, 'client-b')
    ).toBeUndefined();

    const third = manager.begin('client-c');
    if (!third.allowed) throw new Error('Expected the third lease.');
    expect(manager.approvedTranscriptSuffix(third.lease.id, 'client-c')).toBe('');
  });
});

describe('OpenAiRealtimeClient', () => {
  it('mints a client secret with server-only auth, safety id, transcription, and gated VAD', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ value: 'ek_test_ephemeral_secret', expires_at: 1_800_000_010 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const client = new OpenAiRealtimeClient(realtimeConfig, {
      fetch: fetchMock,
      now: () => 1_800_000_000_000
    });

    const result = await client.createClientSecret({
      instructions: 'trusted voice instructions',
      safetyIdentifier: 'alc_test-safety-id'
    });

    expect(result).toEqual({ value: 'ek_test_ephemeral_secret', expiresAt: 1_800_000_010 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer server-only-key',
      'OpenAI-Safety-Identifier': 'alc_test-safety-id'
    });
    const body = JSON.parse(String(init?.body)) as {
      expires_after: { anchor: string; seconds: number };
      session: {
        model: string;
        instructions: string;
        audio: {
          input: {
            transcription: { model: string };
            turn_detection: {
              type: string;
              create_response: boolean;
              eagerness: string;
              interrupt_response: boolean;
            };
          };
        };
      };
    };
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 10 });
    expect(body.session).toMatchObject({
      model: 'gpt-realtime-2.1-mini',
      instructions: 'trusted voice instructions'
    });
    expect(body.session.audio.input.transcription.model).toBe('gpt-4o-mini-transcribe');
    expect(body.session.audio.input.turn_detection.type).toBe('semantic_vad');
    expect(body.session.audio.input.turn_detection.create_response).toBe(false);
    expect(body.session.audio.input.turn_detection.eagerness).toBe('low');
    expect(body.session.audio.input.turn_detection.interrupt_response).toBe(false);
    expect(JSON.stringify(result)).not.toContain('server-only-key');
  });

  it('returns clean errors for upstream failure, malformed JSON, and timeout', async () => {
    const upstreamClient = new OpenAiRealtimeClient(realtimeConfig, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream detail', { status: 500 }))
    });
    await expect(
      upstreamClient.createClientSecret({ instructions: 'safe', safetyIdentifier: 'alc_test' })
    ).rejects.toMatchObject({ reason: 'upstream_unavailable' });

    const invalidClient = new OpenAiRealtimeClient(realtimeConfig, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('{not-json', { status: 200 }))
    });
    await expect(
      invalidClient.createClientSecret({ instructions: 'safe', safetyIdentifier: 'alc_test' })
    ).rejects.toMatchObject({ reason: 'invalid_response' });

    const timeoutFetch = vi.fn<typeof fetch>((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true
        });
      })
    );
    const timeoutClient = new OpenAiRealtimeClient(realtimeConfig, {
      fetch: timeoutFetch,
      timeoutMilliseconds: 5
    });
    await expect(
      timeoutClient.createClientSecret({ instructions: 'safe', safetyIdentifier: 'alc_test' })
    ).rejects.toEqual(expect.objectContaining<Partial<RealtimeClientError>>({ reason: 'timeout' }));
  });

  it('rejects malformed, expired, or unexpectedly long-lived client secrets', async () => {
    const now = () => 1_800_000_000_000;
    for (const responseBody of [
      { value: 'not-an-ephemeral-key', expires_at: 1_800_000_010 },
      { value: 'ek_test_ephemeral_secret', expires_at: 1_800_000_000 },
      { value: 'ek_test_ephemeral_secret', expires_at: 1_800_000_016 }
    ]) {
      const client = new OpenAiRealtimeClient(realtimeConfig, {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
          ),
        now
      });
      await expect(
        client.createClientSecret({ instructions: 'safe', safetyIdentifier: 'alc_test' })
      ).rejects.toMatchObject({ reason: 'invalid_response' });
    }
  });

  it('does not call the upstream when the caller is already disconnected', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new OpenAiRealtimeClient(realtimeConfig, { fetch: fetchMock });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.createClientSecret({
        instructions: 'safe',
        safetyIdentifier: 'alc_test',
        signal: controller.signal
      })
    ).rejects.toMatchObject({ reason: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
