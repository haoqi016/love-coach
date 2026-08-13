import type { Server } from 'node:http';

import { LocalModelProvider, type ModelProvider } from '@alc/agent-core';
import {
  MAX_CONVERSATION_TEXT_LENGTH,
  MAX_USER_CONTEXT_LENGTH
} from '@alc/contracts';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';

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

function chatCompletion(guidance: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(guidance) } }]
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

function selectableModelConfig(): ServerConfig {
  return loadConfig({
    MODEL_API_BASE_URL: 'https://models.example/v1',
    MODEL_API_KEY: 'server-only-key',
    TEXT_MODEL_NAME: 'default-generic-model',
    EAZO_APP_AI_API_BASE: 'https://eazo.example/creator',
    EAZO_APP_ID: 'test-app',
    EAZO_PRIVATE_KEY: 'test-private-key',
    TEXT_MODEL_OPTIONS_JSON: JSON.stringify([
      {
        id: 'generic-choice',
        label: '快速分析',
        description: '使用主办方模型快速整理。',
        provider: 'openai-compatible',
        model: 'private-generic-model'
      },
      {
        id: 'eazo-choice',
        label: '细致分析',
        description: '使用 Eazo 模型细致整理。',
        provider: 'eazo',
        model: 'private-eazo-model'
      }
    ])
  });
}

function selectorOnlyModelConfig(): ServerConfig {
  return loadConfig({
    MODEL_API_BASE_URL: 'https://models.example/v1',
    MODEL_API_KEY: 'server-only-key',
    TEXT_MODEL_OPTIONS_JSON: JSON.stringify([
      {
        id: 'selector-only',
        label: '唯一远程模型',
        description: '由模型白名单提供默认分析。',
        provider: 'openai-compatible',
        model: 'selector-only-upstream'
      }
    ])
  });
}

const openServers: Server[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        })
    )
  );
});

describe('@alc/server', () => {
  it('reports health and assigns a request id', async () => {
    const response = await request(createApp({ config: testConfig })).get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', service: '@alc/server' });
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.headers['content-security-policy']).toContain("img-src 'self' data: blob:");
    expect(response.headers['content-security-policy']).toContain("font-src 'self'");
  });

  it('publishes a sanitized model catalog without making an upstream request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp({ config: selectableModelConfig() }))
      .get('/api/models')
      .expect(200);

    expect(response.body).toEqual({
      defaultModelId: 'auto',
      models: [
        {
          id: 'auto',
          label: '自动选择',
          description: expect.any(String),
          recommended: true
        },
        {
          id: 'generic-choice',
          label: '快速分析',
          description: '使用主办方模型快速整理。',
          recommended: false
        },
        {
          id: 'eazo-choice',
          label: '细致分析',
          description: '使用 Eazo 模型细致整理。',
          recommended: false
        }
      ]
    });
    expect(response.body.models[1]).not.toHaveProperty('provider');
    expect(response.body.models[1]).not.toHaveProperty('model');
    expect(JSON.stringify(response.body)).not.toContain('private-generic-model');
    expect(JSON.stringify(response.body)).not.toContain('private-eazo-model');
    expect(JSON.stringify(response.body)).not.toContain('server-only-key');
    expect(JSON.stringify(response.body)).not.toContain('test-app');
    expect(JSON.stringify(response.body)).not.toContain('test-private-key');
    expect(JSON.stringify(response.body)).not.toContain('https://models.example');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the configured Railway public hostname', async () => {
    await request(
      createApp({
        config: {
          ...testConfig,
          mcpAllowedHosts: [...testConfig.mcpAllowedHosts, 'example.up.railway.app']
        }
      })
    )
      .get('/health')
      .set('Host', 'example.up.railway.app')
      .expect(200);
  });

  it('allows same-origin requests and rejects unapproved cross-origin requests', async () => {
    const app = createApp({ config: testConfig });
    await request(app)
      .get('/health')
      .set('Host', 'localhost')
      .set('Origin', 'http://localhost')
      .expect(200);
    await request(app)
      .get('/health')
      .set('Host', '127.0.0.1:8787')
      .set('Origin', 'http://127.0.0.1:8787')
      .expect(200);

    const denied = await request(app)
      .get('/health')
      .set('Host', 'localhost')
      .set('Origin', 'https://unapproved.example')
      .expect(403);

    expect(denied.body.error.code).toBe('ORIGIN_NOT_ALLOWED');

    const approved = await request(app)
      .get('/health')
      .set('Host', 'localhost:8787')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(approved.headers['access-control-expose-headers']).toContain(
      'X-ALC-Guidance-Source'
    );
    expect(approved.headers['access-control-expose-headers']).toContain(
      'X-ALC-Prompt-Version'
    );
  });

  it('validates and returns normal guidance', async () => {
    const response = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);

    expect(response.body.risk.level).toBe('low');
    expect(response.body.messageOptions.length).toBeGreaterThan(0);
    expect(response.headers['x-alc-guidance-source']).toBe('local');
    expect(response.headers['x-alc-guidance-provider']).toBe('deterministic-local');
    expect(response.headers['x-alc-prompt-version']).toBeUndefined();
  });

  it('accepts a conversation at the 60000-character limit through REST JSON parsing', async () => {
    const response = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send({
        ...validInput,
        conversationText: `我：${'字'.repeat(MAX_CONVERSATION_TEXT_LENGTH - 2)}`
      })
      .expect(200);

    expect(response.body.risk.level).toBe('low');
    expect(response.headers['x-alc-guidance-source']).toBe('local');
  });

  it('rejects public REST context above the 2000-character user budget', async () => {
    const response = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send({
        ...validInput,
        context: '背'.repeat(MAX_USER_CONTEXT_LENGTH + 1)
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_INPUT');
  });

  it('exposes remote model and prompt provenance without changing the JSON body', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(localResponse.body) } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const config: ServerConfig = {
      ...testConfig,
      eazoAppAi: {
        apiBaseUrl: 'https://eazo.example/creator',
        appId: 'test-app',
        privateKey: 'test-private-key',
        textModelKey: 'deepseek.v3.2',
        visionModelKey: 'qwen.qwen3-vl-235b-a22b-instruct',
        maxRequestsPerMinute: 4,
        maxConcurrentRequests: 2,
        maxModelRequestsPerDay: 60
      }
    };

    const response = await request(createApp({ config }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);

    expect(response.body).toEqual(localResponse.body);
    expect(response.headers['x-alc-guidance-source']).toBe('remote');
    expect(response.headers['x-alc-guidance-provider']).toBe('eazo-app-ai:deepseek.v3.2');
    expect(response.headers['x-alc-prompt-version']).toBe('guidance-v4');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses an OpenAI-compatible text provider when it is configured', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => chatCompletion(localResponse.body));
    vi.stubGlobal('fetch', fetchMock);
    const config: ServerConfig = {
      ...testConfig,
      text: {
        apiBaseUrl: 'https://models.example/v1',
        apiKey: 'server-only-key',
        modelName: 'deepseek-v3.2'
      }
    };

    const response = await request(createApp({ config }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);

    expect(response.body).toEqual(localResponse.body);
    expect(response.headers['x-alc-guidance-source']).toBe('remote');
    expect(response.headers['x-alc-guidance-provider']).toBe(
      'openai-compatible:deepseek-v3.2'
    );
    expect(response.headers['x-alc-prompt-version']).toBe('guidance-v4');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://models.example/v1/chat/completions'
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer server-only-key'
    });
  });

  it('honors each explicit model choice without trying another remote provider', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => chatCompletion(localResponse.body));
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp({ config: selectableModelConfig() });

    const genericResponse = await request(app)
      .post('/api/guidance')
      .send({ ...validInput, analysisModelId: 'generic-choice' })
      .expect(200);
    expect(genericResponse.headers['x-alc-guidance-provider']).toBe(
      'openai-compatible:private-generic-model'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://models.example/v1/chat/completions'
    );

    fetchMock.mockClear();
    const eazoResponse = await request(app)
      .post('/api/guidance')
      .send({ ...validInput, analysisModelId: 'eazo-choice' })
      .expect(200);
    expect(eazoResponse.headers['x-alc-guidance-provider']).toBe(
      'eazo-app-ai:private-eazo-model'
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://eazo.example/creator/api/app-ai/chat'
    );
  });

  it('rejects an unavailable model before any upstream request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp({ config: selectableModelConfig() }))
      .post('/api/guidance')
      .send({ ...validInput, analysisModelId: 'missing-model' })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'ANALYSIS_MODEL_NOT_AVAILABLE',
      message: '所选分析模型暂时不可用，请刷新后重新选择。'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back locally after an explicit model fails without trying another remote', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{"error":"temporary"}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp({ config: selectableModelConfig() }))
      .post('/api/guidance')
      .send({ ...validInput, analysisModelId: 'generic-choice' })
      .expect(200);

    expect(response.headers['x-alc-guidance-source']).toBe('local_fallback');
    expect(response.headers['x-alc-guidance-provider']).toBe('deterministic-local');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://models.example/v1/chat/completions'
    );
  });

  it('tries OpenAI-compatible text before Eazo and reports the provider that succeeds', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"error":"temporary"}', { status: 503 }))
      .mockResolvedValueOnce(chatCompletion(localResponse.body));
    vi.stubGlobal('fetch', fetchMock);
    const config: ServerConfig = {
      ...testConfig,
      text: {
        apiBaseUrl: 'https://models.example/v1',
        apiKey: 'server-only-key',
        modelName: 'primary-text'
      },
      eazoAppAi: {
        apiBaseUrl: 'https://eazo.example/creator',
        appId: 'test-app',
        privateKey: 'test-private-key',
        textModelKey: 'deepseek.v3.2',
        visionModelKey: 'qwen.qwen3-vl-235b-a22b-instruct',
        maxRequestsPerMinute: 4,
        maxConcurrentRequests: 2,
        maxModelRequestsPerDay: 60
      }
    };

    const response = await request(createApp({ config }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);

    expect(response.body).toEqual(localResponse.body);
    expect(response.headers['x-alc-guidance-source']).toBe('remote');
    expect(response.headers['x-alc-guidance-provider']).toBe('eazo-app-ai:deepseek.v3.2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://models.example/v1/chat/completions',
      'https://eazo.example/creator/api/app-ai/chat'
    ]);
  });

  it('stops upstream calls at the shared daily budget and falls back locally', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"error":"temporary"}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const config: ServerConfig = {
      ...testConfig,
      remoteUsageLimits: {
        maxRequestsPerMinute: 4,
        maxConcurrentRequests: 2,
        maxModelRequestsPerDay: 1
      },
      text: {
        apiBaseUrl: 'https://models.example/v1',
        apiKey: 'server-only-key',
        modelName: 'primary-text'
      },
      eazoAppAi: {
        apiBaseUrl: 'https://eazo.example/creator',
        appId: 'test-app',
        privateKey: 'test-private-key',
        textModelKey: 'deepseek.v3.2',
        visionModelKey: 'qwen.qwen3-vl-235b-a22b-instruct',
        maxRequestsPerMinute: 4,
        maxConcurrentRequests: 2,
        maxModelRequestsPerDay: 1
      }
    };

    const response = await request(createApp({ config }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);

    expect(response.body.risk.level).toBe('low');
    expect(response.headers['x-alc-guidance-source']).toBe('local_fallback');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(response.body)).not.toContain('request_budget_exceeded');
  });

  it('exposes local fallback provenance without upstream error details', async () => {
    const guidanceProvider: ModelProvider = {
      name: 'eazo-app-ai:test-model',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        throw new Error('private upstream detail');
      }
    };

    const response = await request(createApp({ config: testConfig, guidanceProvider }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);

    expect(response.headers['x-alc-guidance-source']).toBe('local_fallback');
    expect(response.headers['x-alc-guidance-provider']).toBe('deterministic-local');
    expect(response.headers['x-alc-prompt-version']).toBeUndefined();
    expect(JSON.stringify(response.headers)).not.toContain('private upstream detail');
    expect(JSON.stringify(response.body)).not.toContain('private upstream detail');
  });

  it('aborts an in-flight provider when the REST client disconnects', async () => {
    let markProviderStarted: (() => void) | undefined;
    let markProviderAborted: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerAborted = new Promise<void>((resolve) => {
      markProviderAborted = resolve;
    });
    const guidanceProvider: ModelProvider = {
      name: 'disconnect-test-provider',
      generateGuidance(_input, context) {
        const signal = context.signal;
        if (!signal) {
          return Promise.reject(new Error('Expected a request AbortSignal.'));
        }
        markProviderStarted?.();
        return new Promise((_resolve, reject) => {
          const rejectAsAborted = () => {
            markProviderAborted?.();
            reject(new DOMException('Request aborted.', 'AbortError'));
          };
          if (signal.aborted) {
            rejectAsAborted();
            return;
          }
          signal.addEventListener('abort', rejectAsAborted, { once: true });
        });
      }
    };
    const httpServer = createApp({ config: testConfig, guidanceProvider }).listen(
      0,
      '127.0.0.1'
    );
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const controller = new AbortController();
    const pendingRequest = fetch(
      `http://127.0.0.1:${address.port}/api/guidance`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validInput),
        signal: controller.signal
      }
    ).catch((error: unknown) => error);
    await providerStarted;
    controller.abort();

    await pendingRequest;
    await providerAborted;
  });

  it('exposes local safety provenance and skips the remote provider', async () => {
    let providerCallCount = 0;
    const guidanceProvider: ModelProvider = {
      name: 'eazo-app-ai:test-model',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        providerCallCount += 1;
        throw new Error('provider should not be called');
      }
    };

    const response = await request(createApp({ config: testConfig, guidanceProvider }))
      .post('/api/guidance')
      .send({
        ...validInput,
        context: '教我用PUA拿捏对方，如果被拒绝就换小号继续联系。'
      })
      .expect(200);

    expect(response.body.risk.level).toBe('high');
    expect(response.headers['x-alc-guidance-source']).toBe('local_safety');
    expect(response.headers['x-alc-guidance-provider']).toBe('deterministic-safety');
    expect(response.headers['x-alc-prompt-version']).toBeUndefined();
    expect(providerCallCount).toBe(0);
  });

  it('returns a structured error for invalid guidance input', async () => {
    const response = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send({ conversationText: 'too short' })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'INVALID_INPUT',
      requestId: expect.any(String),
      details: expect.any(Array)
    });
  });

  it('keeps screenshots in memory and requires manual review without a vision provider', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
    const response = await request(createApp({ config: testConfig }))
      .post('/api/extract')
      .attach('screenshots', jpeg, { filename: 'chat.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(response.body).toEqual({
      extractedText: '',
      requiresManualReview: true,
      notice: expect.stringContaining('手工录入')
    });
  });

  it('rejects unsupported and malformed images', async () => {
    const app = createApp({ config: testConfig });
    const unsupported = await request(app)
      .post('/api/extract')
      .attach('screenshots', Buffer.from('plain text'), {
        filename: 'chat.txt',
        contentType: 'text/plain'
      })
      .expect(415);
    const malformed = await request(app)
      .post('/api/extract')
      .attach('screenshots', Buffer.from('not a png'), {
        filename: 'chat.png',
        contentType: 'image/png'
      })
      .expect(415);

    expect(unsupported.body.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(malformed.body.error.code).toBe('INVALID_IMAGE');
  });

  it('rejects a screenshot larger than 5 MB', async () => {
    const oversizedJpeg = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    oversizedJpeg.set([0xff, 0xd8, 0xff], 0);
    const response = await request(createApp({ config: testConfig }))
      .post('/api/extract')
      .attach('screenshots', oversizedJpeg, { filename: 'large.jpg', contentType: 'image/jpeg' })
      .expect(413);

    expect(response.body.error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('rejects screenshots whose combined size exceeds the request cap', async () => {
    const firstJpeg = Buffer.alloc(3 * 1024 * 1024, 0);
    const secondJpeg = Buffer.alloc(3 * 1024 * 1024, 0);
    firstJpeg.set([0xff, 0xd8, 0xff], 0);
    secondJpeg.set([0xff, 0xd8, 0xff], 0);
    const response = await request(
      createApp({
        config: { ...testConfig, maxTotalUploadBytes: 5 * 1024 * 1024 }
      })
    )
      .post('/api/extract')
      .attach('screenshots', firstJpeg, { filename: 'first.jpg', contentType: 'image/jpeg' })
      .attach('screenshots', secondJpeg, { filename: 'second.jpg', contentType: 'image/jpeg' })
      .expect(413);

    expect(response.body.error.code).toBe('IMAGES_TOO_LARGE');
  });

  it('rate-limits public AI entry points when a remote provider is enabled', async () => {
    const config: ServerConfig = {
      ...testConfig,
      text: {
        apiBaseUrl: 'https://models.example/v1',
        apiKey: 'server-only-key',
        modelName: 'primary-text'
      },
      remoteUsageLimits: {
        maxRequestsPerMinute: 1,
        maxConcurrentRequests: 4,
        maxModelRequestsPerDay: 60
      }
    };
    const app = createApp({ config, guidanceProvider: new LocalModelProvider() });

    await request(app).post('/api/guidance').send(validInput).expect(200);
    const limited = await request(app).post('/api/guidance/').send(validInput).expect(429);
    await request(app).post('/API/GUIDANCE').send(validInput).expect(429);

    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body.error.code).toBe('REMOTE_RATE_LIMITED');
  });

  it('uses the configured OpenAI-compatible provider through MCP', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const actualFetch = globalThis.fetch;
    const modelFetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://models.example/')) {
        modelFetchMock(input, init);
        return chatCompletion(localResponse.body);
      }
      return actualFetch(input, init);
    });
    const config: ServerConfig = {
      ...testConfig,
      text: {
        apiBaseUrl: 'https://models.example/v1',
        apiKey: 'server-only-key',
        modelName: 'primary-text'
      }
    };
    const httpServer = createApp({ config }).listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-openai-compatible-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      const result = await client.callTool({
        name: 'guide_next_conversation',
        arguments: validInput
      });
      expect(result.structuredContent).toEqual(localResponse.body);
      expect(result._meta).toMatchObject({
        'com.alittlecloser/provenance': {
          source: 'remote',
          provider: 'openai-compatible:primary-text',
          promptVersion: expect.any(String)
        }
      });
      expect(modelFetchMock).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });

  it('uses the same explicit model selection for REST and MCP', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const actualFetch = globalThis.fetch;
    const modelFetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://models.example/') || url.startsWith('https://eazo.example/')) {
        modelFetchMock(input, init);
        return chatCompletion(localResponse.body);
      }
      return actualFetch(input, init);
    });
    const app = createApp({ config: selectableModelConfig() });

    await request(app)
      .post('/api/guidance')
      .send({ ...validInput, analysisModelId: 'eazo-choice' })
      .expect(200);

    const httpServer = app.listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-model-selection-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      const result = await client.callTool({
        name: 'guide_next_conversation',
        arguments: { ...validInput, analysisModelId: 'eazo-choice' }
      });
      expect(result._meta).toMatchObject({
        'com.alittlecloser/provenance': {
          source: 'remote',
          provider: 'eazo-app-ai:private-eazo-model'
        }
      });
      expect(modelFetchMock).toHaveBeenCalledTimes(2);
      expect(modelFetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        'https://eazo.example/creator/api/app-ai/chat',
        'https://eazo.example/creator/api/app-ai/chat'
      ]);
    } finally {
      await client.close();
    }
  });

  it('uses selector-only configuration as auto for legacy REST and MCP requests', async () => {
    const localResponse = await request(createApp({ config: testConfig }))
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    const actualFetch = globalThis.fetch;
    const modelFetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://models.example/')) {
        modelFetchMock(input, init);
        return chatCompletion(localResponse.body);
      }
      return actualFetch(input, init);
    });
    const app = createApp({ config: selectorOnlyModelConfig() });

    const restResponse = await request(app)
      .post('/api/guidance')
      .send(validInput)
      .expect(200);
    expect(restResponse.headers['x-alc-guidance-source']).toBe('remote');
    expect(restResponse.headers['x-alc-guidance-provider']).toBe(
      'openai-compatible:selector-only-upstream'
    );

    const httpServer = app.listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-selector-only-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      const mcpResult = await client.callTool({
        name: 'guide_next_conversation',
        arguments: validInput
      });
      expect(mcpResult._meta).toMatchObject({
        'com.alittlecloser/provenance': {
          source: 'remote',
          provider: 'openai-compatible:selector-only-upstream'
        }
      });
      expect(modelFetchMock).toHaveBeenCalledTimes(2);
      expect(modelFetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        'https://models.example/v1/chat/completions',
        'https://models.example/v1/chat/completions'
      ]);
    } finally {
      await client.close();
    }
  });

  it('rejects an unavailable MCP model before any upstream request', async () => {
    const actualFetch = globalThis.fetch;
    const modelFetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://models.example/') || url.startsWith('https://eazo.example/')) {
        modelFetchMock(input, init);
        return new Response('{"error":"unexpected"}', { status: 500 });
      }
      return actualFetch(input, init);
    });
    const httpServer = createApp({ config: selectableModelConfig() }).listen(
      0,
      '127.0.0.1'
    );
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-unknown-model-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      let requestFailed = false;
      try {
        const result = await client.callTool({
          name: 'guide_next_conversation',
          arguments: { ...validInput, analysisModelId: 'missing-model' }
        });
        requestFailed = result.isError === true;
      } catch {
        requestFailed = true;
      }
      expect(requestFailed).toBe(true);
      expect(modelFetchMock).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('accepts a 60000-character conversation through the official MCP client', async () => {
    const httpServer = createApp({ config: testConfig }).listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-long-conversation-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      const result = await client.callTool({
        name: 'guide_next_conversation',
        arguments: {
          ...validInput,
          conversationText: `我：${'字'.repeat(MAX_CONVERSATION_TEXT_LENGTH - 2)}`
        }
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ risk: { level: 'low' } });
      expect(result._meta).toMatchObject({
        'com.alittlecloser/provenance': {
          source: 'local',
          provider: 'deterministic-local'
        }
      });
    } finally {
      await client.close();
    }
  });

  it('rejects public MCP context above the 2000-character user budget', async () => {
    const httpServer = createApp({ config: testConfig }).listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-context-budget-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      let rejected = false;
      try {
        const result = await client.callTool({
          name: 'guide_next_conversation',
          arguments: {
            ...validInput,
            context: '背'.repeat(MAX_USER_CONTEXT_LENGTH + 1)
          }
        });
        rejected = result.isError === true;
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('does not charge MCP initialization or tool discovery against inference limits', async () => {
    const config: ServerConfig = {
      ...testConfig,
      eazoAppAi: {
        apiBaseUrl: 'https://eazo.example/creator',
        appId: 'test-app',
        privateKey: 'test-private-key',
        textModelKey: 'deepseek.v3.2',
        visionModelKey: 'qwen.qwen3-vl-235b-a22b-instruct',
        maxRequestsPerMinute: 1,
        maxConcurrentRequests: 1,
        maxModelRequestsPerDay: 60
      }
    };
    let providerCallCount = 0;
    const localProvider = new LocalModelProvider();
    const guidanceProvider: ModelProvider = {
      name: 'mcp-limit-test-provider',
      async generateGuidance(input, context) {
        providerCallCount += 1;
        return localProvider.generateGuidance(input, context);
      }
    };
    const httpServer = createApp({ config, guidanceProvider }).listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'mcp-limit-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [expect.objectContaining({ name: 'guide_next_conversation' })]
      });
      await expect(
        client.callTool({ name: 'guide_next_conversation', arguments: validInput })
      ).resolves.toMatchObject({ structuredContent: { risk: { level: 'low' } } });

      let secondCallWasLimited = false;
      try {
        const secondResult = await client.callTool({
          name: 'guide_next_conversation',
          arguments: validInput
        });
        secondCallWasLimited = secondResult.isError === true;
      } catch {
        secondCallWasLimited = true;
      }
      expect(secondCallWasLimited).toBe(true);
      expect(providerCallCount).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('shares an injected guidance provider between REST and MCP', async () => {
    const localProvider = new LocalModelProvider();
    let providerCallCount = 0;
    const guidanceProvider: ModelProvider = {
      name: 'recording-test-provider',
      async generateGuidance(input, context) {
        providerCallCount += 1;
        return localProvider.generateGuidance(input, context);
      }
    };
    const app = createApp({ config: testConfig, guidanceProvider });

    await request(app).post('/api/guidance').send(validInput).expect(200);
    expect(providerCallCount).toBe(1);

    const httpServer = app.listen(0, '127.0.0.1');
    openServers.push(httpServer);
    await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose a TCP port.');
    }

    const client = new Client({ name: 'server-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`))
    );
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['guide_next_conversation']);

      const result = await client.callTool({ name: 'guide_next_conversation', arguments: validInput });
      expect(result.structuredContent).toMatchObject({ risk: { level: 'low' } });
      expect(result._meta).toMatchObject({
        'com.alittlecloser/provenance': {
          source: 'remote',
          provider: 'recording-test-provider'
        }
      });
      expect(result.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.any(String) })])
      );
      expect(providerCallCount).toBe(2);
    } finally {
      await client.close();
    }
  });

  it('exposes only auto selection when a guidance provider is injected', async () => {
    const localProvider = new LocalModelProvider();
    let providerCallCount = 0;
    const guidanceProvider: ModelProvider = {
      name: 'injected-provider',
      async generateGuidance(input, context) {
        providerCallCount += 1;
        return localProvider.generateGuidance(input, context);
      }
    };
    const app = createApp({
      config: selectableModelConfig(),
      guidanceProvider
    });

    const catalog = await request(app).get('/api/models').expect(200);
    expect(catalog.body.models).toEqual([
      expect.objectContaining({ id: 'auto', recommended: true })
    ]);
    await request(app)
      .post('/api/guidance')
      .send({ ...validInput, analysisModelId: 'generic-choice' })
      .expect(400);
    expect(providerCallCount).toBe(0);
  });
});
