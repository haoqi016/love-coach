import {
  MAX_USER_CONTEXT_LENGTH,
  mergeVoiceRefinementContext,
  type GuidanceOutput,
  type GuidanceRequest
} from '@alc/contracts';
import type { ModelProvider } from '@alc/agent-core';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { RealtimeVoiceServerConfig, ServerConfig } from '../src/config.js';

const fixedNow = 1_800_000_000_000;
const signingSecret = 'test-signing-secret-at-least-32-characters';
const realtimeVoice: RealtimeVoiceServerConfig = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'standard-server-key-never-returned',
  model: 'gpt-realtime-2.1-mini',
  voice: 'marin',
  transcriptionModel: 'gpt-4o-mini-transcribe',
  maxSessionSeconds: 300,
  maxActiveLeasesPerInstance: 2,
  maxSessionStartsPerDay: 30,
  contextSigningSecret: signingSecret
};

const testConfig: ServerConfig = {
  port: 8787,
  allowedOrigins: ['http://localhost:5173'],
  maxUploadBytes: 5 * 1024 * 1024,
  maxTotalUploadBytes: 8 * 1024 * 1024,
  maxScreenshots: 3,
  mcpAllowedHosts: ['localhost', '127.0.0.1', '::1'],
  modelChainTimeoutMs: 60_000
};

const validInput = {
  conversationText: [
    '我：你周末一般会做什么？最近有没有发现好喝的咖啡？',
    '对方：我喜欢周末去找小咖啡店，上次喝到一杯桂花拿铁。',
    '我：听起来不错，我也喜欢咖啡，不过还没试过桂花味。',
    '对方：那家环境也挺安静的，我有时候会在那里看书。'
  ].join('\n'),
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'warm'
} as const;

const safeSelectedDraft = '桂花拿铁听起来不错，你最近还发现了什么？';

function clientSecretResponse(value = 'ek_test_ephemeral_client_secret'): Response {
  return new Response(
    JSON.stringify({ value, expires_at: Math.floor(fixedNow / 1_000) + 10 }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

async function guidanceToken(
  app: ReturnType<typeof createApp>,
  input: GuidanceRequest | typeof validInput = validInput
): Promise<{ readonly token: string; readonly guidance: GuidanceOutput }> {
  const response = await request(app).post('/api/guidance').send(input).expect(200);
  const token = response.headers['x-alc-voice-context-token'];
  expect(token).toEqual(expect.any(String));
  return { token: String(token), guidance: response.body as GuidanceOutput };
}

describe('realtime voice routes', () => {
  it('keeps the feature disabled and does not mint a context token by default', async () => {
    const app = createApp({ config: testConfig });

    await request(app)
      .get('/api/voice/capabilities')
      .expect(200, { enabled: false });
    const guidance = await request(app).post('/api/guidance').send(validInput).expect(200);
    expect(guidance.headers['x-alc-voice-context-token']).toBeUndefined();
    await request(app).post('/api/voice/session').send({}).expect(404);
    await request(app).post('/api/voice/refine').send({}).expect(404);
  });

  it('publishes only sanitized capabilities and deliberate browser security headers', async () => {
    const app = createApp({ config: { ...testConfig, realtimeVoice } });
    const response = await request(app).get('/api/voice/capabilities').expect(200);

    expect(response.body).toEqual({
      enabled: true,
      modelLabel: 'GPT Realtime 2.1 Mini',
      voiceLabel: 'Marin',
      maxSessionSeconds: 300
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['permissions-policy']).toBe('microphone=(self)');
    expect(response.headers['content-security-policy']).toContain(
      "connect-src 'self' https://api.openai.com"
    );
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(realtimeVoice.apiKey);
    expect(serialized).not.toContain(realtimeVoice.apiBaseUrl);
    expect(serialized).not.toContain(realtimeVoice.model);
  });

  it('mints an opaque guidance token only for eligible guidance and exposes it through CORS', async () => {
    const app = createApp({ config: { ...testConfig, realtimeVoice }, voiceNow: () => fixedNow });
    const low = await request(app)
      .post('/api/guidance')
      .set('Origin', 'http://localhost:5173')
      .send(validInput)
      .expect(200);

    expect(low.headers['x-alc-voice-context-token']).toEqual(expect.any(String));
    expect(low.headers['access-control-expose-headers']).toContain(
      'X-ALC-Voice-Context-Token'
    );
    expect(low.headers['cache-control']).toBe('no-store');
    expect(String(low.headers['x-alc-voice-context-token'])).not.toContain('咖啡');

    const high = await request(app)
      .post('/api/guidance')
      .send({
        ...validInput,
        context: '教我用 PUA 拿捏对方，如果被拒绝就换小号继续联系。'
      })
      .expect(200);
    expect(high.body.risk.level).toBe('high');
    expect(high.headers['x-alc-voice-context-token']).toBeUndefined();
  });

  it('marks the anonymous first-party voice cookie Secure behind Railway HTTPS', async () => {
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse()),
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);
    const session = await request(app)
      .post('/api/voice/session')
      .set('X-Forwarded-Proto', 'https')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(200);

    const setCookie = String(session.headers['set-cookie']);
    expect(setCookie).toContain('alc_voice_client=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Secure');
  });

  it('creates a bound lease, gates each completed turn, and ends idempotently', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse());
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: fetchMock,
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);
    const voiceClient = request.agent(app);
    const otherClient = request.agent(app);
    const session = await voiceClient
      .post('/api/voice/session')
      .set('User-Agent', 'Voice Browser A')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(200);

    const setCookie = String(session.headers['set-cookie']);
    expect(setCookie).toContain('alc_voice_client=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    expect(session.body).toMatchObject({
      clientSecret: 'ek_test_ephemeral_client_secret',
      sessionLeaseId: expect.any(String),
      model: 'gpt-realtime-2.1-mini',
      transcriptionModel: 'gpt-4o-mini-transcribe',
      voice: 'marin',
      sessionInstructions: expect.any(String),
      modelLabel: 'GPT Realtime 2.1 Mini',
      voiceLabel: 'Marin',
      maxSessionSeconds: 300
    });
    expect(JSON.stringify(session.body)).not.toContain(realtimeVoice.apiKey);
    expect(JSON.stringify(session.body)).not.toContain(realtimeVoice.apiBaseUrl);
    expect(fetchMock).toHaveBeenCalledOnce();
    const upstreamHeaders = fetchMock.mock.calls[0]?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(upstreamHeaders?.['OpenAI-Safety-Identifier']).toMatch(/^alc_[0-9a-f]{48}$/u);
    expect(upstreamHeaders?.['OpenAI-Safety-Identifier']).not.toContain('Voice Browser A');
    const upstreamBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(upstreamBody).not.toContain(validInput.conversationText);
    expect(upstreamBody).toContain(safeSelectedDraft);
    const upstreamSession = (JSON.parse(upstreamBody) as {
      session: {
        model: string;
        instructions: string;
        audio: {
          input: { transcription: { model: string } };
          output: { voice: string };
        };
      };
    }).session;
    expect(session.body.model).toBe(upstreamSession.model);
    expect(session.body.sessionInstructions).toBe(upstreamSession.instructions);
    expect(session.body.transcriptionModel).toBe(
      upstreamSession.audio.input.transcription.model
    );
    expect(session.body.voice).toBe(upstreamSession.audio.output.voice);
    expect(upstreamSession.instructions).toContain(safeSelectedDraft);

    const allowed = await voiceClient
      .post('/api/voice/turn-safety')
      .set('User-Agent', 'Voice Browser A after update')
      .send({
        sessionLeaseId: session.body.sessionLeaseId,
        transcript: '我想把语气调整得自然一点。',
        adultConfirmed: true
      })
      .expect(200);
    expect(allowed.body).toMatchObject({ action: 'allow', reason: 'low' });

    await otherClient
      .post('/api/voice/turn-safety')
      .set('User-Agent', 'Different Browser')
      .send({
        sessionLeaseId: session.body.sessionLeaseId,
        transcript: '这是另一个客户端。',
        adultConfirmed: true
      })
      .expect(409);

    await voiceClient
      .post('/api/voice/end')
      .set('User-Agent', 'Voice Browser A')
      .send({ sessionLeaseId: session.body.sessionLeaseId })
      .expect(204);
    await voiceClient
      .post('/api/voice/end')
      .set('User-Agent', 'Voice Browser A')
      .send({ sessionLeaseId: session.body.sessionLeaseId })
      .expect(204);
    await voiceClient
      .post('/api/voice/turn-safety')
      .set('User-Agent', 'Voice Browser A')
      .send({
        sessionLeaseId: session.body.sessionLeaseId,
        transcript: '会话结束后不能继续。',
        adultConfirmed: true
      })
      .expect(409);
  });

  it('fails closed on a dangerous turn and releases the active lease', async () => {
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse()),
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);
    const voiceClient = request.agent(app);
    const session = await voiceClient
      .post('/api/voice/session')
      .set('User-Agent', 'Safety Browser')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(200);

    const stopped = await voiceClient
      .post('/api/voice/turn-safety')
      .set('User-Agent', 'Safety Browser')
      .send({
        sessionLeaseId: session.body.sessionLeaseId,
        transcript: '我准备偷偷查定位，然后去蹲守对方。',
        adultConfirmed: true
      })
      .expect(200);
    expect(stopped.body).toMatchObject({
      action: 'safety_stop',
      reason: 'high_risk',
      risk: { level: 'high' }
    });

    await voiceClient
      .post('/api/voice/turn-safety')
      .set('User-Agent', 'Safety Browser')
      .send({
        sessionLeaseId: session.body.sessionLeaseId,
        transcript: '继续普通建议。',
        adultConfirmed: true
      })
      .expect(409);
  });

  it('stops and invalidates a lease when violence or age disclosure is split across turns', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => clientSecretResponse());
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: fetchMock,
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);
    const cases = [
      {
        firstTranscript: '我要杀',
        secondTranscript: '了她。',
        reason: 'crisis'
      },
      {
        firstTranscript: '我今年1',
        secondTranscript: '7岁。',
        reason: 'under_18'
      }
    ] as const;

    for (const testCase of cases) {
      const voiceClient = request.agent(app);
      const session = await voiceClient
        .post('/api/voice/session')
        .send({
          voiceContextToken: token,
          selectedDraft: safeSelectedDraft,
          adultConfirmed: true
        })
        .expect(200);

      const first = await voiceClient
        .post('/api/voice/turn-safety')
        .send({
          sessionLeaseId: session.body.sessionLeaseId,
          transcript: testCase.firstTranscript,
          adultConfirmed: true
        })
        .expect(200);
      expect(first.body).toMatchObject({ action: 'allow', reason: 'low' });

      const stopped = await voiceClient
        .post('/api/voice/turn-safety')
        .send({
          sessionLeaseId: session.body.sessionLeaseId,
          transcript: testCase.secondTranscript,
          adultConfirmed: true
        })
        .expect(200);
      expect(stopped.body).toMatchObject({
        action: 'safety_stop',
        reason: testCase.reason
      });

      await voiceClient
        .post('/api/voice/turn-safety')
        .send({
          sessionLeaseId: session.body.sessionLeaseId,
          transcript: '会话停止后不能继续。',
          adultConfirmed: true
        })
        .expect(409);
    }

    expect(fetchMock).toHaveBeenCalledTimes(cases.length);
  });

  it('requires a safe current draft before contacting the realtime provider', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse());
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: fetchMock,
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);

    await request(app)
      .post('/api/voice/session')
      .send({ voiceContextToken: token, adultConfirmed: true })
      .expect(400);
    const unsafe = await request(app)
      .post('/api/voice/session')
      .send({
        voiceContextToken: token,
        selectedDraft: '我想用 PUA 操控对方，让对方离不开我。',
        adultConfirmed: true
      })
      .expect(400);
    const unsafeGuarantee = await request(app)
      .post('/api/voice/session')
      .send({
        voiceContextToken: token,
        selectedDraft: '这样说保证一定能追到对方。',
        adultConfirmed: true
      })
      .expect(400);
    const underageDraft = await request(app)
      .post('/api/voice/session')
      .send({
        voiceContextToken: token,
        selectedDraft: '其实我今年16岁，想把语气放轻。',
        adultConfirmed: true
      })
      .expect(400);

    expect(unsafe.body.error.code).toBe('UNSAFE_VOICE_DRAFT');
    expect(unsafeGuarantee.body.error.code).toBe('UNSAFE_VOICE_DRAFT');
    expect(underageDraft.body.error.code).toBe('UNSAFE_VOICE_DRAFT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects tampered or expired context and requires explicit adult confirmation', async () => {
    let now = fixedNow;
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse()),
      voiceNow: () => now
    });
    const { token } = await guidanceToken(app);

    await request(app)
      .post('/api/voice/session')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: false })
      .expect(400);
    await request(app)
      .post('/api/voice/session')
      .send({
        voiceContextToken: `${token.slice(0, -1)}A`,
        selectedDraft: safeSelectedDraft,
        adultConfirmed: true
      })
      .expect(400);
    now += 10 * 60 * 1_000;
    const expired = await request(app)
      .post('/api/voice/session')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(400);
    expect(expired.body.error.code).toBe('INVALID_VOICE_CONTEXT');
  });

  it('releases a failed start and never exposes upstream error details', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private upstream failure and key', { status: 500 }))
      .mockResolvedValueOnce(clientSecretResponse('ek_test_second_ephemeral_secret'));
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      realtimeFetch: fetchMock,
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);
    const voiceClient = request.agent(app);

    const failed = await voiceClient
      .post('/api/voice/session')
      .set('User-Agent', 'Retry Browser')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(503);
    expect(failed.body.error).toMatchObject({
      code: 'VOICE_UPSTREAM_UNAVAILABLE',
      message: 'Realtime voice is temporarily unavailable.'
    });
    expect(JSON.stringify(failed.body)).not.toContain('private upstream');
    expect(JSON.stringify(failed.body)).not.toContain(realtimeVoice.apiKey);

    await voiceClient
      .post('/api/voice/session')
      .set('User-Agent', 'Retry Browser')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(200);
  });

  it('enforces per-client, instance, and daily session-start limits with retry metadata', async () => {
    const limitedVoice: RealtimeVoiceServerConfig = {
      ...realtimeVoice,
      maxActiveLeasesPerInstance: 1,
      maxSessionStartsPerDay: 1
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice: limitedVoice },
      realtimeFetch: vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse()),
      voiceNow: () => fixedNow
    });
    const { token } = await guidanceToken(app);
    const clientA = request.agent(app);
    const clientB = request.agent(app);
    const first = await clientA
      .post('/api/voice/session')
      .set('User-Agent', 'Limited Browser A')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(200);

    const sameClient = await clientA
      .post('/api/voice/session')
      .set('User-Agent', 'Limited Browser A')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(429);
    expect(sameClient.body.error.code).toBe('VOICE_SESSION_LIMITED');
    expect(Number(sameClient.headers['retry-after'])).toBeGreaterThan(0);

    const atCapacity = await clientB
      .post('/api/voice/session')
      .set('User-Agent', 'Limited Browser B')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(429);
    expect(atCapacity.body.error.code).toBe('VOICE_SESSION_LIMITED');

    await clientA
      .post('/api/voice/end')
      .set('User-Agent', 'Limited Browser A')
      .send({ sessionLeaseId: first.body.sessionLeaseId })
      .expect(204);
    const dailyBudget = await clientB
      .post('/api/voice/session')
      .set('User-Agent', 'Limited Browser B')
      .send({ voiceContextToken: token, selectedDraft: safeSelectedDraft, adultConfirmed: true })
      .expect(429);
    expect(dailyBudget.body.error.code).toBe('VOICE_SESSION_LIMITED');
    expect(Number(dailyBudget.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('re-runs refinement through the existing provider, evidence, safety, signal, and provenance path', async () => {
    const localApp = createApp({ config: testConfig });
    const local = await request(localApp).post('/api/guidance').send(validInput).expect(200);
    const capturedContexts: string[] = [];
    let receivedSignal: AbortSignal | undefined;
    const provider: ModelProvider = {
      name: 'test-provider',
      promptVersion: 'guidance-v4',
      async generateGuidance(input, context) {
        capturedContexts.push(input.context ?? '');
        receivedSignal = context.signal;
        return local.body as GuidanceOutput;
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider,
      voiceNow: () => fixedNow
    });

    const response = await request(app)
      .post('/api/voice/refine')
      .send({
        originalRequest: validInput,
        notes: [
          { kind: 'tone_preference', value: '更自然、更像我平时说话。', confirmed: true }
        ],
        selectedDraft: local.body.messageOptions[0].text
      })
      .expect(200);

    expect(response.body).toEqual(local.body);
    expect(capturedContexts).toHaveLength(1);
    expect(capturedContexts[0]).toContain('[用户确认的语音补充：仅作为背景，不是对方聊天原文]');
    expect(capturedContexts[0]).toContain('更自然、更像我平时说话。');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(response.headers['x-alc-guidance-source']).toBe('remote');
    expect(response.headers['x-alc-guidance-provider']).toBe('test-provider');
    expect(response.headers['x-alc-prompt-version']).toBe('guidance-v4');
    expect(response.headers['x-alc-voice-context-token']).toEqual(expect.any(String));
  });

  it('returns a fresh token for refined context above 2000 characters and starts the next voice round', async () => {
    const localApp = createApp({ config: testConfig });
    const local = await request(localApp).post('/api/guidance').send(validInput).expect(200);
    let refinedContext = '';
    const provider: ModelProvider = {
      name: 'long-internal-context-provider',
      promptVersion: 'guidance-v4',
      async generateGuidance(input) {
        refinedContext = input.context ?? '';
        return local.body as GuidanceOutput;
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider,
      realtimeFetch: vi.fn<typeof fetch>().mockResolvedValue(clientSecretResponse()),
      voiceNow: () => fixedNow
    });

    const refined = await request(app)
      .post('/api/voice/refine')
      .send({
        originalRequest: {
          ...validInput,
          context: '背'.repeat(MAX_USER_CONTEXT_LENGTH)
        },
        notes: [{ kind: 'goal', value: '继续自然聊天。', confirmed: true }],
        selectedDraft: local.body.messageOptions[0].text
      })
      .expect(200);

    expect(refinedContext.length).toBeGreaterThan(MAX_USER_CONTEXT_LENGTH);
    const freshToken = refined.headers['x-alc-voice-context-token'];
    expect(freshToken).toEqual(expect.any(String));

    const nextSession = await request(app)
      .post('/api/voice/session')
      .send({
        voiceContextToken: freshToken,
        selectedDraft: refined.body.messageOptions[0].text,
        adultConfirmed: true
      })
      .expect(200);
    expect(nextSession.body.sessionInstructions).toContain(
      refined.body.messageOptions[0].text
    );
  });

  it('rejects an unapproved refinement model before any provider call', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      name: 'must-not-run',
      async generateGuidance() {
        providerCalls += 1;
        throw new Error('The provider must not run for an invalid selection.');
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider
    });

    const response = await request(app)
      .post('/api/voice/refine')
      .send({
        originalRequest: { ...validInput, analysisModelId: 'unapproved-model' },
        notes: [{ kind: 'goal', value: '继续自然聊天。', confirmed: true }],
        selectedDraft: safeSelectedDraft
      })
      .expect(400);

    expect(response.body.error.code).toBe('ANALYSIS_MODEL_NOT_AVAILABLE');
    expect(providerCalls).toBe(0);
  });

  it('rejects unsafe refinement drafts, notes, and split-boundary text before any provider call', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      name: 'must-not-run-for-unsafe-refinement',
      async generateGuidance() {
        providerCalls += 1;
        throw new Error('The provider must not receive unsafe refinement text.');
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider
    });
    const cases = [
      {
        selectedDraft: '这样说保证一定能追到对方。',
        notes: [{ kind: 'goal', value: '继续自然聊天。', confirmed: true }],
        expectedCode: 'UNSAFE_VOICE_DRAFT'
      },
      {
        selectedDraft: '其实我今年16岁，想把语气放轻。',
        notes: [{ kind: 'goal', value: '继续自然聊天。', confirmed: true }],
        expectedCode: 'UNSAFE_VOICE_DRAFT'
      },
      {
        selectedDraft: safeSelectedDraft,
        notes: [{ kind: 'other', value: '我想用 PUA 操控对方。', confirmed: true }],
        expectedCode: 'UNSAFE_VOICE_NOTE'
      },
      {
        selectedDraft: safeSelectedDraft,
        notes: [
          { kind: 'other', value: '我要杀', confirmed: true },
          { kind: 'other', value: '了她。', confirmed: true }
        ],
        expectedCode: 'UNSAFE_VOICE_NOTE'
      },
      {
        selectedDraft: safeSelectedDraft,
        notes: [
          { kind: 'other', value: '其实我今年1', confirmed: true },
          { kind: 'other', value: '6岁，想把语气放轻。', confirmed: true }
        ],
        expectedCode: 'UNSAFE_VOICE_NOTE'
      }
    ] as const;

    for (const testCase of cases) {
      const response = await request(app)
        .post('/api/voice/refine')
        .send({
          originalRequest: validInput,
          notes: testCase.notes,
          selectedDraft: testCase.selectedDraft
        })
        .expect(400);
      expect(response.body.error.code).toBe(testCase.expectedCode);
    }

    const historicalUnderageContext = mergeVoiceRefinementContext(
      undefined,
      [{ kind: 'other', value: '其实我今年16岁。', confirmed: true }],
      safeSelectedDraft
    );
    const historicalUnderage = await request(app)
      .post('/api/voice/refine')
      .send({
        originalRequest: {
          ...validInput,
          context: historicalUnderageContext
        },
        notes: [{ kind: 'goal', value: '继续自然聊天。', confirmed: true }],
        selectedDraft: safeSelectedDraft
      })
      .expect(400);
    expect(historicalUnderage.body.error.code).toBe('UNSAFE_VOICE_CONTEXT');

    expect(providerCalls).toBe(0);
  });

  it('rejects safety text split across historical and current voice rounds before any provider call', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      name: 'must-not-run-for-cross-round-unsafe-refinement',
      async generateGuidance() {
        providerCalls += 1;
        throw new Error('The provider must not receive cross-round unsafe text.');
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider
    });
    const cases = [
      { historical: '我要杀', current: '了她。' },
      { historical: '我今年1', current: '7岁。' }
    ] as const;

    for (const testCase of cases) {
      const historicalContext = mergeVoiceRefinementContext(
        undefined,
        [{ kind: 'other', value: testCase.historical, confirmed: true }],
        safeSelectedDraft
      );
      const response = await request(app)
        .post('/api/voice/refine')
        .send({
          originalRequest: { ...validInput, context: historicalContext },
          notes: [
            { kind: 'other', value: testCase.current, confirmed: true }
          ],
          selectedDraft: safeSelectedDraft
        })
        .expect(400);
      expect(response.body.error.code).toBe('UNSAFE_VOICE_CONTEXT');
    }

    expect(providerCalls).toBe(0);
  });

  it('rejects an oversized user context base before any refinement provider call', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      name: 'must-not-run-for-oversized-context-base',
      async generateGuidance() {
        providerCalls += 1;
        throw new Error('The provider must not receive an oversized user context base.');
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider
    });
    const canonicalBlock = mergeVoiceRefinementContext(
      undefined,
      [{ kind: 'other', value: '第一轮补充。', confirmed: true }],
      safeSelectedDraft
    );
    const invalidContexts = [
      '背'.repeat(MAX_USER_CONTEXT_LENGTH + 1),
      `${'背'.repeat(MAX_USER_CONTEXT_LENGTH + 1)}\n\n${canonicalBlock}`
    ];

    for (const context of invalidContexts) {
      const response = await request(app)
        .post('/api/voice/refine')
        .send({
          originalRequest: { ...validInput, context },
          notes: [{ kind: 'goal', value: '继续自然聊天。', confirmed: true }],
          selectedDraft: safeSelectedDraft
        })
        .expect(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    }

    expect(providerCalls).toBe(0);
  });

  it('preserves the previous guidance when the refinement provider fails', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      name: 'failing-refinement-provider',
      async generateGuidance() {
        providerCalls += 1;
        throw new Error('private upstream failure');
      }
    };
    const app = createApp({
      config: { ...testConfig, realtimeVoice },
      guidanceProvider: provider
    });

    const response = await request(app)
      .post('/api/voice/refine')
      .send({
        originalRequest: validInput,
        notes: [{ kind: 'goal', value: '把语气放轻一点。', confirmed: true }],
        selectedDraft: safeSelectedDraft
      })
      .expect(503);

    expect(providerCalls).toBe(1);
    expect(response.body.error).toMatchObject({
      code: 'VOICE_REFINEMENT_UNAVAILABLE',
      message: 'Voice refinement could not update the guidance. The previous result is unchanged.'
    });
    expect(response.body).not.toHaveProperty('messageOptions');
    expect(JSON.stringify(response.body)).not.toContain('private upstream failure');
  });

  it('does not present deterministic local guidance as a voice-refined result', async () => {
    const app = createApp({ config: { ...testConfig, realtimeVoice } });

    const response = await request(app)
      .post('/api/voice/refine')
      .send({
        originalRequest: validInput,
        notes: [{ kind: 'goal', value: '把语气放轻一点。', confirmed: true }],
        selectedDraft: safeSelectedDraft
      })
      .expect(503);

    expect(response.body.error.code).toBe('VOICE_REFINEMENT_UNAVAILABLE');
    expect(response.headers['x-alc-guidance-source']).toBeUndefined();
    expect(response.body).not.toHaveProperty('messageOptions');
  });
});
