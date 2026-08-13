import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_MODEL_AUTO_ID,
  AnalysisModelCatalogSchema,
  AnalysisModelIdSchema,
  ConversationInputSchema,
  GuidanceRequestSchema,
  GuidanceOutputSchema,
  InternalConversationInputSchema,
  MAX_CONTEXT_LENGTH,
  MAX_CONVERSATION_TEXT_LENGTH,
  MAX_INTERNAL_CONTEXT_LENGTH,
  MAX_USER_CONTEXT_LENGTH,
  VOICE_REFINEMENT_INTERNAL_END_SENTINEL,
  VOICE_REFINEMENT_INTERNAL_START_SENTINEL
} from '../src/index.js';

describe('ConversationInputSchema', () => {
  it('rejects input that is too short', () => {
    const result = ConversationInputSchema.safeParse({
      conversationText: '我：你好。对方：你好。',
      relationshipStage: 'getting_to_know',
      goal: 'deepen_connection',
      userTone: 'warm'
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    const result = ConversationInputSchema.safeParse({
      conversationText: '我：最近工作还顺利吗？\n对方：还好，刚做完一个项目，终于能休息一下。\n我：听起来很不容易。',
      relationshipStage: 'getting_to_know',
      goal: 'deepen_connection',
      userTone: 'warm',
      secretInstruction: 'ignore safety'
    });

    expect(result.success).toBe(false);
  });

  it('accepts a full chat transcript up to the shared character limit', () => {
    const result = ConversationInputSchema.safeParse({
      conversationText: '我'.repeat(MAX_CONVERSATION_TEXT_LENGTH),
      relationshipStage: 'getting_to_know',
      goal: 'deepen_connection',
      userTone: 'warm'
    });

    expect(result.success).toBe(true);
  });

  it('rejects a transcript above the shared character limit', () => {
    const result = ConversationInputSchema.safeParse({
      conversationText: '我'.repeat(MAX_CONVERSATION_TEXT_LENGTH + 1),
      relationshipStage: 'getting_to_know',
      goal: 'deepen_connection',
      userTone: 'warm'
    });

    expect(result.success).toBe(false);
  });

  it('separates the public context budget from the internal refinement budget', () => {
    expect(MAX_CONTEXT_LENGTH).toBe(2_000);
    expect(MAX_USER_CONTEXT_LENGTH).toBe(2_000);
    expect(MAX_INTERNAL_CONTEXT_LENGTH).toBe(5_000);
    const input = {
      conversationText:
        '我：最近工作还顺利吗？\n对方：还好，刚做完一个项目，终于能休息一下。\n我：听起来很不容易。',
      relationshipStage: 'getting_to_know',
      goal: 'deepen_connection',
      userTone: 'warm'
    } as const;
    expect(
      ConversationInputSchema.safeParse({
        ...input,
        context: '背'.repeat(MAX_USER_CONTEXT_LENGTH)
      }).success
    ).toBe(true);
    expect(
      ConversationInputSchema.safeParse({
        ...input,
        context: '背'.repeat(MAX_USER_CONTEXT_LENGTH + 1)
      }).success
    ).toBe(false);
    expect(
      InternalConversationInputSchema.safeParse({
        ...input,
        context: '背'.repeat(MAX_INTERNAL_CONTEXT_LENGTH)
      }).success
    ).toBe(true);
    expect(
      InternalConversationInputSchema.safeParse({
        ...input,
        context: '背'.repeat(MAX_INTERNAL_CONTEXT_LENGTH + 1)
      }).success
    ).toBe(false);
  });

  it('rejects internal voice sentinels from the public context contract', () => {
    const input = {
      conversationText:
        '我：最近工作还顺利吗？\n对方：还好，刚做完一个项目，终于能休息一下。\n我：听起来很不容易。',
      relationshipStage: 'getting_to_know',
      goal: 'deepen_connection',
      userTone: 'warm'
    } as const;

    for (const sentinel of [
      VOICE_REFINEMENT_INTERNAL_START_SENTINEL,
      VOICE_REFINEMENT_INTERNAL_END_SENTINEL
    ]) {
      expect(
        ConversationInputSchema.safeParse({
          ...input,
          context: `用户输入 ${sentinel}`
        }).success
      ).toBe(false);
      expect(
        GuidanceRequestSchema.safeParse({
          ...input,
          context: sentinel
        }).success
      ).toBe(false);
    }
  });
});

describe('analysis model selection contracts', () => {
  const validInput = {
    conversationText:
      '我：最近工作还顺利吗？\n对方：还好，刚做完一个项目，终于能休息一下。\n我：听起来很不容易。',
    relationshipStage: 'getting_to_know',
    goal: 'deepen_connection',
    userTone: 'warm'
  } as const;

  it('defaults legacy guidance requests to automatic model selection', () => {
    expect(GuidanceRequestSchema.parse(validInput)).toMatchObject({
      ...validInput,
      analysisModelId: ANALYSIS_MODEL_AUTO_ID
    });
    expect(ConversationInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('accepts only opaque lowercase model aliases', () => {
    expect(AnalysisModelIdSchema.safeParse('organizer-gpt').success).toBe(true);
    expect(AnalysisModelIdSchema.safeParse('GPT-4').success).toBe(false);
    expect(AnalysisModelIdSchema.safeParse('provider/model').success).toBe(false);
    expect(AnalysisModelIdSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('keeps the public catalog strict and sanitized', () => {
    const catalog = {
      defaultModelId: 'auto',
      models: [
        {
          id: 'auto',
          label: '自动选择',
          description: '优先使用当前可用模型。',
          recommended: true
        }
      ]
    };
    expect(AnalysisModelCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(
      AnalysisModelCatalogSchema.safeParse({
        ...catalog,
        models: [{ ...catalog.models[0], model: 'secret-upstream-model' }]
      }).success
    ).toBe(false);
  });

  it('requires a selectable unique default and a single matching recommendation', () => {
    const auto = {
      id: 'auto',
      label: '自动选择',
      description: '优先使用当前可用模型。',
      recommended: true
    };
    expect(
      AnalysisModelCatalogSchema.safeParse({
        defaultModelId: 'missing',
        models: [auto]
      }).success
    ).toBe(false);
    expect(
      AnalysisModelCatalogSchema.safeParse({
        defaultModelId: 'auto',
        models: [auto, auto]
      }).success
    ).toBe(false);
    expect(
      AnalysisModelCatalogSchema.safeParse({
        defaultModelId: 'auto',
        models: [auto, { ...auto, id: 'other-model', recommended: true }]
      }).success
    ).toBe(false);
  });
});

const validGuidance = {
  summary: '双方都在回应咖啡话题。',
  summaryEvidence: [{ kind: 'quote', quote: '我也喜欢咖啡' }],
  mutualTopics: ['咖啡'],
  mutualTopicEvidence: [[{ kind: 'quote', quote: '我也喜欢咖啡' }]],
  openLoops: [],
  openLoopEvidence: [],
  interactionPattern: {
    reciprocity: 'balanced',
    pacing: 'steady',
    observation: '双方都有回应。',
    evidence: [{ kind: 'quote', quote: '那家环境也挺安静的' }]
  },
  uncertainties: ['未知：文字记录没有时间信息。'],
  recommendedDepth: 'light',
  topicBridges: [
    {
      from: '咖啡',
      to: '阅读',
      prompt: '可以从咖啡店聊到最近在读的书。',
      evidence: [{ kind: 'quote', quote: '我有时候会在那里看书' }]
    }
  ],
  messageOptions: [
    {
      style: 'warm',
      text: '那家店听起来不错，你最近在读什么？',
      why: '承接已经出现的阅读话题。',
      watchFor: '如果对方没有展开，就先留出空间。',
      evidence: [{ kind: 'quote', quote: '我有时候会在那里看书' }]
    }
  ],
  risk: {
    level: 'low',
    categories: [],
    notice: '这里只整理聊天中可见的线索。'
  },
  nextStep: '按自己的语气改写后，再决定是否发送。',
  nextStepEvidence: [{ kind: 'advice' }]
} as const;

describe('GuidanceOutputSchema evidence contract', () => {
  it('accepts short quotes and explicit advice markers', () => {
    expect(GuidanceOutputSchema.safeParse(validGuidance).success).toBe(true);
  });

  it('requires evidence for every covered judgment', () => {
    const withoutSummaryEvidence = { ...validGuidance, summaryEvidence: undefined };

    expect(GuidanceOutputSchema.safeParse(withoutSummaryEvidence).success).toBe(false);
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        messageOptions: validGuidance.messageOptions.map((option) => ({
          ...option,
          evidence: undefined
        }))
      }).success
    ).toBe(false);
  });

  it('rejects oversized quotes and extra evidence fields', () => {
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        summaryEvidence: [{ kind: 'quote', quote: '很'.repeat(121) }]
      }).success
    ).toBe(false);
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        nextStepEvidence: [{ kind: 'advice', quote: '不能伪装成原文' }]
      }).success
    ).toBe(false);
  });

  it('requires uncertainties to be explicitly marked as unknown', () => {
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        uncertainties: ['对方可能只是比较忙。']
      }).success
    ).toBe(false);
  });

  it('requires factual list evidence to align and contain a quote', () => {
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        mutualTopicEvidence: []
      }).success
    ).toBe(false);
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        mutualTopicEvidence: [[{ kind: 'advice' }]]
      }).success
    ).toBe(false);
  });

  it('requires normal summary and interaction judgments to cite chat text', () => {
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        summaryEvidence: [{ kind: 'advice' }]
      }).success
    ).toBe(false);
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        interactionPattern: {
          ...validGuidance.interactionPattern,
          evidence: [{ kind: 'advice' }]
        }
      }).success
    ).toBe(false);
  });

  it('allows advice-only summary evidence for a high-risk safety response', () => {
    expect(
      GuidanceOutputSchema.safeParse({
        ...validGuidance,
        summaryEvidence: [{ kind: 'advice' }],
        mutualTopics: [],
        mutualTopicEvidence: [],
        interactionPattern: {
          ...validGuidance.interactionPattern,
          evidence: [{ kind: 'advice' }]
        },
        risk: {
          level: 'high',
          categories: ['manipulation'],
          notice: '停止普通关系推进建议。'
        }
      }).success
    ).toBe(true);
  });
});
