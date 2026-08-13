import {
  ANALYSIS_MODEL_AUTO_ID,
  AnalysisModelIdSchema
} from '@alc/contracts';
import type {
  AnalysisModelCatalog,
  GuidanceOutput,
  GuidanceRequest
} from '@alc/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ApiModule from './api';

const input: GuidanceRequest = {
  conversationText:
    '我：周末去了一家新咖啡店，店里的音乐很好听。\n对方：我也喜欢找安静的咖啡店。\n我：那你最近最喜欢哪一家？\n对方：公司附近那家，甜品也不错。',
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'natural',
  analysisModelId: ANALYSIS_MODEL_AUTO_ID
};

const eventModelId = AnalysisModelIdSchema.parse('event-gpt41-mini');
const modelCatalog: AnalysisModelCatalog = {
  defaultModelId: ANALYSIS_MODEL_AUTO_ID,
  models: [
    {
      id: ANALYSIS_MODEL_AUTO_ID,
      label: '自动选择（推荐）',
      description: '优先使用主模型，失败后尝试备用模型。',
      recommended: true
    },
    {
      id: eventModelId,
      label: 'GPT-4.1 mini',
      description: '速度与稳定性优先。',
      recommended: false
    }
  ]
};

const restGuidance: GuidanceOutput = {
  summary: '来自 REST 服务的建议。',
  summaryEvidence: [{ kind: 'quote', quote: '我也喜欢找安静的咖啡店' }],
  mutualTopics: ['美食'],
  mutualTopicEvidence: [[{ kind: 'quote', quote: '甜品也不错' }]],
  openLoops: [],
  openLoopEvidence: [],
  interactionPattern: {
    reciprocity: 'balanced',
    pacing: 'steady',
    observation: '双方都有回应。',
    evidence: [{ kind: 'quote', quote: '公司附近那家，甜品也不错' }]
  },
  uncertainties: ['未知：文字记录没有时间间隔。'],
  recommendedDepth: 'personal',
  topicBridges: [],
  messageOptions: [
    {
      style: 'natural',
      text: '听起来不错，下次有机会一起去。',
      why: '承接已有话题。',
      watchFor: '尊重对方的回应节奏。',
      evidence: [{ kind: 'quote', quote: '公司附近那家，甜品也不错' }]
    }
  ],
  risk: {
    level: 'low',
    categories: [],
    notice: '未发现需要中止普通建议的风险。'
  },
  nextStep: '按自己的语气改写后再决定是否发送。',
  nextStepEvidence: [{ kind: 'advice' }]
};

async function loadApi(staticDemo: boolean): Promise<typeof ApiModule> {
  vi.resetModules();
  vi.stubEnv('VITE_STATIC_DEMO', staticDemo ? 'true' : '');
  return import('./api');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('web API mode routing', () => {
  it('uses the existing REST endpoint by default', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(restGuidance), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { requestGuidance, STATIC_DEMO_ENABLED } = await loadApi(false);

    const result = await requestGuidance(input);

    expect(STATIC_DEMO_ENABLED).toBe(false);
    expect(result).toEqual({ guidance: restGuidance, provenance: null });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/guidance');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      analysisModelId: 'auto'
    });
  });

  it('submits the explicitly selected analysis model id', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(restGuidance), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { requestGuidance } = await loadApi(false);

    await requestGuidance({ ...input, analysisModelId: eventModelId });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      analysisModelId: 'event-gpt41-mini'
    });
  });

  it('uses the browser-local Agent Core provider in static demo mode', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const { requestGuidance, STATIC_DEMO_ENABLED } = await loadApi(true);

    const result = await requestGuidance(input);

    expect(STATIC_DEMO_ENABLED).toBe(true);
    expect(result.guidance.summary.length).toBeGreaterThan(0);
    expect(result.guidance.messageOptions.length).toBeGreaterThan(0);
    expect(result.guidance.risk.level).toBe('low');
    expect(result.provenance).toEqual({
      source: 'local',
      provider: 'deterministic-local'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads non-sensitive provenance headers from the REST response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(restGuidance), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-ALC-Guidance-Source': 'remote',
          'X-ALC-Guidance-Provider': 'eazo-app-ai:deepseek.v3.2',
          'X-ALC-Prompt-Version': 'guidance-v2'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { requestGuidance } = await loadApi(false);

    const result = await requestGuidance(input);

    expect(result).toEqual({
      guidance: restGuidance,
      provenance: {
        source: 'remote',
        provider: 'eazo-app-ai:deepseek.v3.2',
        promptVersion: 'guidance-v2'
      }
    });
  });

  it('retains a validated opaque voice context token only in guidance memory', async () => {
    const voiceContextToken = `voice.${'a'.repeat(40)}.signature`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(restGuidance), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-ALC-Guidance-Source': 'remote',
          'X-ALC-Voice-Context-Token': voiceContextToken
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { requestGuidance } = await loadApi(false);

    const result = await requestGuidance(input);

    expect(result.voiceContextToken).toBe(voiceContextToken);
  });

  it('returns an explicit manual screenshot fallback in static demo mode', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const { extractConversation } = await loadApi(true);

    const result = await extractConversation([]);

    expect(result).toEqual({
      extractedText: '',
      requiresManualReview: true,
      notice: '静态演示不会上传或自动识别截图。请在下方手工粘贴聊天文字，并逐句校对说话人。'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads the sanitized model catalog with an independent 8 second timeout', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(modelCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const setTimeoutMock = vi.fn(() => 1);
    const clearTimeoutMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock
    });
    const {
      fetchAnalysisModelCatalog,
      MODEL_CATALOG_REQUEST_TIMEOUT_MS
    } = await loadApi(false);

    const result = await fetchAnalysisModelCatalog();

    expect(result).toEqual(modelCatalog);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/models',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    );
    expect(MODEL_CATALOG_REQUEST_TIMEOUT_MS).toBe(8_000);
    expect(setTimeoutMock).toHaveBeenCalledWith(
      expect.any(Function),
      MODEL_CATALOG_REQUEST_TIMEOUT_MS
    );
    expect(clearTimeoutMock).toHaveBeenCalledOnce();
  });

  it('uses a disabled local-only catalog in static mode without any network call', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const {
      fetchAnalysisModelCatalog,
      STATIC_DEMO_ANALYSIS_MODEL_CATALOG
    } = await loadApi(true);

    const result = await fetchAnalysisModelCatalog();

    expect(result).toEqual(STATIC_DEMO_ANALYSIS_MODEL_CATALOG);
    expect(result.models[0]?.label).toBe('本地基础整理（静态演示）');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces catalog loading failure so the UI can keep the auto fallback', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: '模型目录暂时不可用' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout
    });
    const { fetchAnalysisModelCatalog } = await loadApi(false);

    await expect(fetchAnalysisModelCatalog()).rejects.toThrow('模型目录暂时不可用');
  });

  it('allows 70 seconds for both remote model-backed routes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(restGuidance), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            extractedText: '我：你好\n对方：你好',
            requiresManualReview: false,
            notice: '识别完成'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    const setTimeoutMock = vi.fn(() => 1);
    const clearTimeoutMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock
    });
    const {
      BROWSER_REQUEST_TIMEOUT_MS,
      extractConversation,
      requestGuidance
    } = await loadApi(false);

    await requestGuidance(input);
    await extractConversation([]);

    expect(BROWSER_REQUEST_TIMEOUT_MS).toBe(70_000);
    expect(setTimeoutMock).toHaveBeenCalledTimes(2);
    expect(setTimeoutMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      BROWSER_REQUEST_TIMEOUT_MS
    );
    expect(setTimeoutMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      BROWSER_REQUEST_TIMEOUT_MS
    );
    expect(clearTimeoutMock).toHaveBeenCalledTimes(2);
  });
});
