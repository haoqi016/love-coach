import type { ConversationInput, GuidanceOutput, RiskAssessment } from '@alc/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildStrategyProfile,
  GUIDANCE_PROMPT_VERSION,
  OpenAiCompatibleError,
  OpenAiCompatibleProvider,
  type OpenAiCompatibleProviderOptions
} from '../src/index.js';

const input: ConversationInput = {
  conversationText: '我：你周末会做什么？\n对方：我喜欢去小咖啡店看书。',
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'warm'
};

const safety: RiskAssessment = {
  level: 'low',
  categories: [],
  notice: '这里只根据你提供的文字整理沟通线索，无法判断对方真实想法。'
};

const guidance: GuidanceOutput = {
  summary: '对方提到咖啡店和看书，可以承接已出现的话题。',
  summaryEvidence: [{ kind: 'quote', quote: '我喜欢去小咖啡店看书' }],
  mutualTopics: [],
  mutualTopicEvidence: [],
  openLoops: ['对方提到在咖啡店看书。'],
  openLoopEvidence: [[{ kind: 'quote', quote: '我喜欢去小咖啡店看书' }]],
  interactionPattern: {
    reciprocity: 'limited_data',
    pacing: 'limited_data',
    observation: '只有一轮对话，无法判断稳定的互动节奏。',
    evidence: [{ kind: 'quote', quote: '你周末会做什么？' }]
  },
  uncertainties: ['未知：文字不包含回复间隔或线下背景。'],
  recommendedDepth: 'light',
  topicBridges: [
    {
      from: '咖啡店',
      to: '阅读',
      prompt: '先回应咖啡店，再问一个低压力的阅读问题。',
      evidence: [{ kind: 'quote', quote: '我喜欢去小咖啡店看书' }]
    }
  ],
  messageOptions: [
    {
      style: 'warm',
      text: '听起来很惬意。你最近在看什么书？有空再聊就好。',
      why: '承接对方直接提到的阅读话题。',
      watchFor: '如果对方没有展开，不要连续追问。',
      evidence: [{ kind: 'quote', quote: '我喜欢去小咖啡店看书' }]
    }
  ],
  risk: safety,
  nextStep: '按自己的语气改写，也可以选择暂时不发。',
  nextStepEvidence: [{ kind: 'advice' }]
};

function chatCompletion(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl_test',
      choices: [{ message: { role: 'assistant', content } }]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function options(
  fetchImplementation: typeof globalThis.fetch
): OpenAiCompatibleProviderOptions {
  return {
    apiBaseUrl: 'https://gateway.example/openai/',
    apiKey: 'event_test_key',
    model: 'event-model',
    providerName: 'openai-next:event-model',
    fetch: fetchImplementation
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenAiCompatibleProvider', () => {
  it('rejects non-HTTPS endpoints before a credential can be sent', () => {
    expect(
      () =>
        new OpenAiCompatibleProvider({
          ...options(async () => chatCompletion('unused')),
          apiBaseUrl: 'http://gateway.example'
        })
    ).toThrow('OpenAI-compatible apiBaseUrl must use HTTPS.');
  });

  it('posts Bearer-authenticated chat completions with the shared prompt', async () => {
    let capturedInput: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImplementation: typeof globalThis.fetch = async (request, init) => {
      capturedInput = request;
      capturedInit = init;
      return chatCompletion(JSON.stringify(guidance));
    };
    const provider = new OpenAiCompatibleProvider(options(fetchImplementation));

    await expect(provider.generateGuidance(input, { safety })).resolves.toEqual(guidance);

    expect(String(capturedInput)).toBe(
      'https://gateway.example/openai/v1/chat/completions'
    );
    expect(capturedInit?.method).toBe('POST');
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer event_test_key');
    expect(headers.get('content-type')).toBe('application/json');
    const requestBody = JSON.parse(String(capturedInit?.body)) as {
      model: string;
      stream: boolean;
      temperature: number;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(requestBody).toMatchObject({
      model: 'event-model',
      stream: false,
      temperature: 0.2,
      max_tokens: 1_800
    });
    expect(requestBody.messages[0]?.content).toContain('严格按以下流程形成结果');
    expect(requestBody.messages[0]?.content).toContain('strategyProfile');
    expect(requestBody.messages[0]?.content).toContain('实际体现');
    expect(requestBody.messages[0]?.content).toContain('用户选中的旧草稿');
    expect(requestBody.messages[0]?.content).toContain('第一条 messageOption.text');
    expect(requestBody.messages[0]?.content).toContain('可辨认的修订基础');
    expect(requestBody.messages[0]?.content).toContain(
      '“本轮更正” > “历史更正”'
    );
    expect(requestBody.messages[0]?.content).toContain(
      '普通“本轮补充/历史补充”'
    );
    expect(requestBody.messages[0]?.content).toContain('不得把新旧矛盾内容同时混入建议');
    expect(JSON.parse(requestBody.messages[1]!.content)).toEqual({
      input,
      authoritativeRisk: safety,
      strategyProfile: buildStrategyProfile(input),
      canonicalVoiceRefinement: false
    });
    expect(provider.name).toBe('openai-next:event-model');
    expect(provider.promptVersion).toBe(GUIDANCE_PROMPT_VERSION);
  });

  it('does not duplicate v1 when the base already ends with it', async () => {
    let capturedInput: RequestInfo | URL | undefined;
    const provider = new OpenAiCompatibleProvider({
      ...options(async (request) => {
        capturedInput = request;
        return chatCompletion(JSON.stringify(guidance));
      }),
      apiBaseUrl: 'https://gateway.example/v1'
    });

    await provider.generateGuidance(input, { safety });

    expect(String(capturedInput)).toBe(
      'https://gateway.example/v1/chat/completions'
    );
  });

  it('uses a non-sensitive default provenance name', () => {
    const provider = new OpenAiCompatibleProvider({
      apiBaseUrl: 'https://gateway.example',
      apiKey: 'event_test_key',
      model: 'event-model',
      fetch: async () => chatCompletion(JSON.stringify(guidance))
    });

    expect(provider.name).toBe('openai-compatible:event-model');
    expect(JSON.stringify(provider)).not.toContain('event_test_key');
  });

  it('rejects a per-provider timeout above one minute', () => {
    expect(
      () =>
        new OpenAiCompatibleProvider({
          ...options(async () => chatCompletion(JSON.stringify(guidance))),
          timeoutMs: 60_001
        })
    ).toThrow(/timeoutMs/u);
  });

  it('shares Eazo tolerance for one outer JSON code fence', async () => {
    const provider = new OpenAiCompatibleProvider(
      options(async () =>
        chatCompletion(`\`\`\`json\n${JSON.stringify(guidance)}\n\`\`\``)
      )
    );

    await expect(provider.generateGuidance(input, { safety })).resolves.toEqual(guidance);
  });

  it('rejects malformed guidance JSON', async () => {
    const provider = new OpenAiCompatibleProvider(
      options(async () => chatCompletion('{"summary":'))
    );

    await expect(provider.generateGuidance(input, { safety })).rejects.toMatchObject({
      name: 'OpenAiCompatibleError',
      code: 'invalid_json'
    });
  });

  it('strictly validates guidance against the shared contract', async () => {
    const provider = new OpenAiCompatibleProvider(
      options(async () =>
        chatCompletion(JSON.stringify({ ...guidance, unexpectedField: true }))
      )
    );

    await expect(provider.generateGuidance(input, { safety })).rejects.toMatchObject({
      name: 'OpenAiCompatibleError',
      code: 'schema_validation_failed'
    });
  });

  it('rejects a malformed chat-completion envelope', async () => {
    const provider = new OpenAiCompatibleProvider(
      options(async () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );

    await expect(provider.generateGuidance(input, { safety })).rejects.toMatchObject({
      code: 'invalid_response'
    });
  });

  it.each([
    [401, 'authentication_error'],
    [403, 'authentication_error'],
    [429, 'rate_limited'],
    [500, 'upstream_error'],
    [503, 'upstream_error'],
    [400, 'upstream_http_error']
  ] as const)('classifies HTTP %i as %s', async (status, code) => {
    const provider = new OpenAiCompatibleProvider(
      options(async () => new Response('{}', { status }))
    );

    await expect(provider.generateGuidance(input, { safety })).rejects.toMatchObject({
      code,
      status
    });
  });

  it('uses a one-minute default timeout and exposes a typed timeout error', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const provider = new OpenAiCompatibleProvider({
      ...options((_request, init) => {
        signal = init?.signal;
        return new Promise<Response>(() => undefined);
      })
    });

    const request = provider.generateGuidance(input, { safety });
    const rejection = expect(request).rejects.toMatchObject({ code: 'request_timeout' });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(signal?.aborted).toBe(true);
  });

  it('honors an external signal even when the injected fetch remains pending', async () => {
    const controller = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const provider = new OpenAiCompatibleProvider(
      options((_request, init) => {
        fetchSignal = init?.signal;
        return new Promise<Response>(() => undefined);
      })
    );

    const request = provider.generateGuidance(input, {
      safety,
      signal: controller.signal
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'GuidanceRunAbortedError',
      code: 'external_abort'
    });
    await Promise.resolve();
    await Promise.resolve();

    controller.abort();
    await rejection;
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('wraps fetch failures without exposing their details in the public message', async () => {
    const provider = new OpenAiCompatibleProvider(
      options(async () => {
        throw new Error('private socket detail');
      })
    );

    const request = provider.generateGuidance(input, { safety });
    await expect(request).rejects.toBeInstanceOf(OpenAiCompatibleError);
    await expect(request).rejects.toMatchObject({
      code: 'network_error',
      message: 'OpenAI-compatible request failed.'
    });
  });
});
