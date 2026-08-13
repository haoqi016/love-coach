import type { ConversationInput, GuidanceOutput } from '@alc/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  guideNextConversation,
  guideNextConversationDetailed,
  type ModelProvider
} from '../src/index.js';

const baseInput: ConversationInput = {
  conversationText: [
    '我：你周末一般会做什么？最近有没有发现好喝的咖啡？',
    '对方：我喜欢周末去找小咖啡店，上次喝到一杯桂花拿铁。',
    '我：听起来不错，我也喜欢咖啡，不过还没试过桂花味。',
    '对方：那家环境也挺安静的，我有时候会在那里看书。'
  ].join('\n'),
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'warm'
};

afterEach(() => {
  vi.useRealTimers();
});

function providerReturning(output: GuidanceOutput): ModelProvider {
  return {
    name: 'adversarial-test-provider',
    async generateGuidance() {
      return output;
    }
  };
}

describe('guideNextConversation', () => {
  it('reports remote provider and prompt provenance without changing guidance', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const remoteGuidance = { ...localGuidance, summary: '来自远程模型的结果。' };
    const provider: ModelProvider = {
      name: 'eazo-app-ai:deepseek.v3.2',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        return remoteGuidance;
      }
    };

    const result = await guideNextConversationDetailed(baseInput, { provider });

    expect(result.guidance).toEqual(remoteGuidance);
    expect(result.provenance).toEqual({
      source: 'remote',
      provider: 'eazo-app-ai:deepseek.v3.2',
      promptVersion: 'guidance-v2'
    });
  });

  it('accepts server-owned refined context above the public 2000-character budget', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    let receivedContext = '';
    const provider: ModelProvider = {
      name: 'internal-context-provider',
      async generateGuidance(input) {
        receivedContext = input.context ?? '';
        return localGuidance;
      }
    };
    const internalContext = '内'.repeat(2_001);

    const result = await guideNextConversationDetailed(
      { ...baseInput, context: internalContext },
      { provider, fallbackToLocal: false }
    );

    expect(result.provenance.source).toBe('remote');
    expect(receivedContext).toBe(internalContext);
  });

  it('reports a local fallback without leaking the failed provider error', async () => {
    const provider: ModelProvider = {
      name: 'eazo-app-ai:deepseek.v3.2',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        throw new Error('private upstream detail');
      }
    };

    const result = await guideNextConversationDetailed(baseInput, { provider });

    expect(result.guidance.summary.length).toBeGreaterThan(0);
    expect(result.provenance).toEqual({
      source: 'local_fallback',
      provider: 'deterministic-local'
    });
    expect(JSON.stringify(result)).not.toContain('private upstream detail');
  });

  it('tries providers in order and reports the provider that actually succeeds', async () => {
    const calls: string[] = [];
    const localGuidance = await guideNextConversation(baseInput);
    const successfulGuidance = { ...localGuidance, summary: '第二个 Provider 的结果。' };
    const firstProvider: ModelProvider = {
      name: 'openai-next:first-model',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        calls.push('first');
        throw new Error('first provider unavailable');
      }
    };
    const secondProvider: ModelProvider = {
      name: 'eazo-app-ai:second-model',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        calls.push('second');
        return successfulGuidance;
      }
    };

    const result = await guideNextConversationDetailed(baseInput, {
      providers: [firstProvider, secondProvider]
    });

    expect(calls).toEqual(['first', 'second']);
    expect(result.guidance).toEqual(successfulGuidance);
    expect(result.provenance).toEqual({
      source: 'remote',
      provider: 'eazo-app-ai:second-model',
      promptVersion: 'guidance-v2'
    });
  });

  it('uses local guidance only after every configured provider fails', async () => {
    const calls: string[] = [];
    const providers: ModelProvider[] = ['first', 'second'].map((name) => ({
      name,
      async generateGuidance() {
        calls.push(name);
        throw new Error(`${name} unavailable`);
      }
    }));

    const result = await guideNextConversationDetailed(baseInput, { providers });

    expect(calls).toEqual(['first', 'second']);
    expect(result.provenance).toEqual({
      source: 'local_fallback',
      provider: 'deterministic-local'
    });
  });

  it('stops a hanging remote chain at the overall deadline and falls back locally', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let firstSignal: AbortSignal | undefined;
    const firstProvider: ModelProvider = {
      name: 'hanging-primary',
      generateGuidance(_input, context) {
        calls.push('first');
        firstSignal = context.signal;
        return new Promise<GuidanceOutput>(() => undefined);
      }
    };
    const secondProvider: ModelProvider = {
      name: 'must-not-start-after-timeout',
      async generateGuidance() {
        calls.push('second');
        throw new Error('second provider must not start');
      }
    };

    const request = guideNextConversationDetailed(baseInput, {
      providers: [firstProvider, secondProvider],
      overallTimeoutMs: 50
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['first']);

    await vi.advanceTimersByTimeAsync(50);
    const result = await request;

    expect(firstSignal?.aborted).toBe(true);
    expect(calls).toEqual(['first']);
    expect(result.provenance).toEqual({
      source: 'local_fallback',
      provider: 'deterministic-local'
    });
  });

  it('gives fallback providers only the time remaining in the shared deadline', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let secondSignal: AbortSignal | undefined;
    const firstProvider: ModelProvider = {
      name: 'slow-failing-primary',
      generateGuidance() {
        calls.push('first');
        return new Promise<GuidanceOutput>((_resolve, reject) => {
          setTimeout(() => reject(new Error('primary failed after 40ms')), 40);
        });
      }
    };
    const secondProvider: ModelProvider = {
      name: 'hanging-secondary',
      generateGuidance(_input, context) {
        calls.push('second');
        secondSignal = context.signal;
        return new Promise<GuidanceOutput>(() => undefined);
      }
    };

    let settled = false;
    const request = guideNextConversationDetailed(baseInput, {
      providers: [firstProvider, secondProvider],
      overallTimeoutMs: 100
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['first']);

    await vi.advanceTimersByTimeAsync(40);
    expect(calls).toEqual(['first', 'second']);
    await vi.advanceTimersByTimeAsync(59);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await request;
    expect(settled).toBe(true);
    expect(secondSignal?.aborted).toBe(true);
    expect(result.provenance.source).toBe('local_fallback');
  });

  it('throws overall_timeout instead of starting another Provider when fallback is disabled', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let firstSignal: AbortSignal | undefined;
    const firstProvider: ModelProvider = {
      name: 'hanging-primary',
      generateGuidance(_input, context) {
        calls.push('first');
        firstSignal = context.signal;
        return new Promise<GuidanceOutput>(() => undefined);
      }
    };
    const secondProvider: ModelProvider = {
      name: 'must-not-start-after-timeout',
      async generateGuidance() {
        calls.push('second');
        throw new Error('second provider must not start');
      }
    };

    const request = guideNextConversationDetailed(baseInput, {
      providers: [firstProvider, secondProvider],
      fallbackToLocal: false,
      overallTimeoutMs: 50
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'GuidanceRunAbortedError',
      code: 'overall_timeout'
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['first']);

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    expect(firstSignal?.aborted).toBe(true);
    expect(calls).toEqual(['first']);
  });

  it('propagates caller abort without starting another Provider or local fallback', async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    let firstSignal: AbortSignal | undefined;
    const firstProvider: ModelProvider = {
      name: 'hanging-primary',
      generateGuidance(_input, context) {
        calls.push('first');
        firstSignal = context.signal;
        return new Promise<GuidanceOutput>(() => undefined);
      }
    };
    const secondProvider: ModelProvider = {
      name: 'must-not-start-after-abort',
      async generateGuidance() {
        calls.push('second');
        throw new Error('second provider must not start');
      }
    };

    const request = guideNextConversationDetailed(baseInput, {
      providers: [firstProvider, secondProvider],
      signal: controller.signal
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'GuidanceRunAbortedError',
      code: 'external_abort'
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['first']);

    controller.abort();
    await rejection;
    expect(firstSignal?.aborted).toBe(true);
    expect(calls).toEqual(['first']);
  });

  it('continues to the next provider when an earlier output fails safety checks', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const unsafeProvider = providerReturning({
      ...localGuidance,
      summary: '先消失三天让她着急。'
    });
    const safeGuidance = { ...localGuidance, summary: '安全的第二个结果。' };
    const safeProvider: ModelProvider = {
      name: 'safe-second-provider',
      async generateGuidance() {
        return safeGuidance;
      }
    };

    const result = await guideNextConversationDetailed(baseInput, {
      providers: [unsafeProvider, safeProvider]
    });

    expect(result.guidance).toEqual(safeGuidance);
    expect(result.provenance.provider).toBe('safe-second-provider');
  });

  it('tries the full chain then rejects the last error when local fallback is disabled', async () => {
    const calls: string[] = [];
    const providers: ModelProvider[] = ['first', 'second'].map((name) => ({
      name,
      async generateGuidance() {
        calls.push(name);
        throw new Error(`${name} unavailable`);
      }
    }));

    await expect(
      guideNextConversationDetailed(baseInput, {
        providers,
        fallbackToLocal: false
      })
    ).rejects.toThrow('second unavailable');
    expect(calls).toEqual(['first', 'second']);
  });

  it('rejects unsafe remote output when local fallback is disabled', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const unsafeProvider = providerReturning({
      ...localGuidance,
      summary: '先消失三天让她着急。'
    });

    await expect(
      guideNextConversationDetailed(baseInput, {
        provider: unsafeProvider,
        fallbackToLocal: false
      })
    ).rejects.toMatchObject({
      name: 'ModelOutputRejectedError',
      code: 'unsafe_model_output'
    });
  });

  it('rejects ambiguous or empty provider-chain configuration', async () => {
    const provider = providerReturning(await guideNextConversation(baseInput));

    await expect(
      guideNextConversationDetailed(baseInput, {
        provider,
        providers: [provider]
      })
    ).rejects.toThrow(/both provider and providers/i);
    await expect(
      guideNextConversationDetailed(baseInput, { providers: [] })
    ).rejects.toThrow(/at least one provider/i);
  });

  it('reports a local safety short-circuit without calling the remote provider', async () => {
    let providerCallCount = 0;
    const provider: ModelProvider = {
      name: 'eazo-app-ai:deepseek.v3.2',
      promptVersion: 'guidance-v2',
      async generateGuidance() {
        providerCallCount += 1;
        throw new Error('provider should not be called');
      }
    };

    const result = await guideNextConversationDetailed(
      {
        ...baseInput,
        context: '教我用PUA拿捏对方，如果被拒绝就换小号继续联系。'
      },
      { provider }
    );

    expect(result.guidance.risk.level).toBe('high');
    expect(result.provenance).toEqual({
      source: 'local_safety',
      provider: 'deterministic-safety'
    });
    expect(providerCallCount).toBe(0);
  });

  it('builds structured guidance for a normal two-sided conversation', async () => {
    const result = await guideNextConversation(baseInput);

    expect(result.interactionPattern.reciprocity).toBe('balanced');
    expect(result.mutualTopics).toContain('美食');
    expect(result.messageOptions.length).toBeGreaterThanOrEqual(1);
    expect(result.messageOptions[0]?.text).not.toMatch(/\d{1,3}%/u);
    expect(result.risk.level).toBe('low');
    expect(result.summaryEvidence.some((basis) => basis.kind === 'quote')).toBe(true);
    expect(
      result.interactionPattern.evidence.some((basis) => basis.kind === 'quote')
    ).toBe(true);
    expect(result.mutualTopicEvidence).toHaveLength(result.mutualTopics.length);
    expect(result.openLoopEvidence).toHaveLength(result.openLoops.length);
    for (const basis of [
      ...result.summaryEvidence,
      ...result.interactionPattern.evidence,
      ...result.mutualTopicEvidence.flat(),
      ...result.openLoopEvidence.flat()
    ]) {
      if (basis.kind === 'quote') {
        expect(baseInput.conversationText).toContain(basis.quote);
      }
    }
  });

  it('rejects a fabricated evidence quote instead of presenting it as chat text', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const provider = providerReturning({
      ...localGuidance,
      summaryEvidence: [{ kind: 'quote', quote: '这句话从未出现在聊天里' }]
    });

    await expect(
      guideNextConversation(baseInput, { provider, fallbackToLocal: false })
    ).rejects.toThrow(/evidence quote/i);
  });

  it('rejects remote guidance whose depth exceeds the selected relationship stage', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const provider = providerReturning({
      ...localGuidance,
      recommendedDepth: 'vulnerable'
    });

    await expect(
      guideNextConversation(baseInput, { provider, fallbackToLocal: false })
    ).rejects.toThrow(/recommended depth.*relationship stage/i);
  });

  it('accepts an exact unsafe-sounding chat quote without treating it as generated advice', async () => {
    const quotedInput: ConversationInput = {
      ...baseInput,
      conversationText: [
        '我：朋友给了一个建议，但我觉得听起来不太尊重人。',
        '对方：他说先消失三天让她着急，我也觉得这样不合适。',
        '我：我更希望直接表达，也给别人选择的空间。',
        '对方：对，正常说清楚就好。'
      ].join('\n')
    };
    const localGuidance = await guideNextConversation(quotedInput);
    const exactQuote = '他说先消失三天让她着急，我也觉得这样不合适。';
    const remoteGuidance: GuidanceOutput = {
      ...localGuidance,
      summary: '双方都明确不采用操控式建议，适合继续直接沟通。',
      summaryEvidence: [{ kind: 'quote', quote: exactQuote }]
    };

    const result = await guideNextConversationDetailed(quotedInput, {
      provider: providerReturning(remoteGuidance),
      fallbackToLocal: false
    });

    expect(result.provenance.source).toBe('remote');
    expect(result.guidance.summaryEvidence).toEqual([
      { kind: 'quote', quote: exactQuote }
    ]);
  });

  it('rejects evidence arrays that do not align with their judgments', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const provider = providerReturning({
      ...localGuidance,
      mutualTopicEvidence: []
    });

    await expect(
      guideNextConversation(baseInput, { provider, fallbackToLocal: false })
    ).rejects.toThrow(/mutualTopicEvidence 必须与 mutualTopics/iu);
  });

  it('rejects advice markers used in place of evidence for factual list items', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const provider = providerReturning({
      ...localGuidance,
      mutualTopicEvidence: localGuidance.mutualTopicEvidence.map(() => [
        { kind: 'advice' as const }
      ]),
      openLoopEvidence: localGuidance.openLoopEvidence.map(() => [
        { kind: 'advice' as const }
      ])
    });

    await expect(
      guideNextConversation(baseInput, { provider, fallbackToLocal: false })
    ).rejects.toThrow(/共同话题必须至少引用一条聊天原文/u);
  });

  it('does not over-interpret a one-sided excerpt', async () => {
    const result = await guideNextConversation({
      ...baseInput,
      conversationText: [
        '我：你好，我刚看到你分享的电影，感觉很有意思。',
        '我：我也很喜欢那位导演之前的作品，不知道你最喜欢哪一部？'
      ].join('\n')
    });

    expect(result.interactionPattern.reciprocity).toBe('limited_data');
    expect(result.recommendedDepth).toBe('light');
    expect(result.uncertainties.join('')).toContain('不足');
  });

  it('refuses manipulation and bypassing rejection', async () => {
    const result = await guideNextConversation({
      ...baseInput,
      context: '教我用PUA拿捏对方，如果被拒绝就换小号继续联系。'
    });

    expect(result.risk.level).toBe('high');
    expect(result.risk.categories).toContain('manipulation');
    expect(result.recommendedDepth).toBe('pause');
    expect(result.nextStep).toContain('停止');
    expect(result.messageOptions[0]?.text).toContain('尊重');
  });

  it('escalates self-harm or violence signals instead of coaching romance', async () => {
    const result = await guideNextConversation({
      ...baseInput,
      conversationText: [
        '我：如果她还是不愿意理我，我真的不想活了，也不知道还能怎么办。',
        '对方：你先冷静一下，联系一下身边的朋友，不要一个人待着。'
      ].join('\n')
    });

    expect(result.risk.level).toBe('crisis');
    expect(result.risk.categories).toContain('self_harm');
    expect(result.nextStep).toContain('紧急服务');
    expect(result.recommendedDepth).toBe('pause');
  });

  it('falls back locally when any provider risk component contradicts deterministic safety', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const mismatchedRisks: GuidanceOutput['risk'][] = [
      { ...localGuidance.risk, level: 'caution' },
      { ...localGuidance.risk, notice: `${localGuidance.risk.notice}（远端改写）` },
      { ...localGuidance.risk, categories: ['privacy'] }
    ];

    for (const [index, risk] of mismatchedRisks.entries()) {
      const remoteSummary = `不应展示的远端结果 ${index}`;
      const result = await guideNextConversation(baseInput, {
        provider: providerReturning({ ...localGuidance, summary: remoteSummary, risk })
      });

      expect(result.summary).not.toBe(remoteSummary);
      expect(result.risk).toEqual(localGuidance.risk);
    }
  });

  it('throws on provider risk mismatch when local fallback is disabled', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const provider = providerReturning({
      ...localGuidance,
      risk: { ...localGuidance.risk, categories: ['privacy'] }
    });

    await expect(
      guideNextConversation(baseInput, { provider, fallbackToLocal: false })
    ).rejects.toThrow(/risk assessment/i);
  });

  it('falls back when the first remote message style does not match the requested tone', async () => {
    const localGuidance = await guideNextConversation(baseInput);
    const mismatchedGuidance: GuidanceOutput = {
      ...localGuidance,
      summary: '不应展示的语气不匹配结果',
      messageOptions: localGuidance.messageOptions.map((option, index) =>
        index === 0 ? { ...option, style: 'direct' } : option
      )
    };
    const provider = providerReturning(mismatchedGuidance);

    const fallback = await guideNextConversationDetailed(baseInput, { provider });

    expect(fallback.guidance.summary).not.toBe(mismatchedGuidance.summary);
    expect(fallback.provenance.source).toBe('local_fallback');
    await expect(
      guideNextConversation(baseInput, { provider, fallbackToLocal: false })
    ).rejects.toThrow(/message option style/i);
  });

  it('treats provider risk categories as a set', async () => {
    const cautionInput: ConversationInput = {
      ...baseInput,
      context: '材料里可能含有手机号，请提醒我先隐藏隐私。'
    };
    const localGuidance = await guideNextConversation(cautionInput);
    const remoteSummary = '风险集合一致的远端结果';
    const provider = providerReturning({
      ...localGuidance,
      summary: remoteSummary,
      risk: { ...localGuidance.risk, categories: ['privacy', 'privacy'] }
    });

    const result = await guideNextConversation(cautionInput, { provider });

    expect(result.summary).toBe(remoteSummary);
  });
});
