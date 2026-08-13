import {
  goalEnum,
  relationshipStageEnum,
  userToneEnum,
  type ConversationInput,
  type Goal,
  type RelationshipStage,
  type UserTone
} from '@alc/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildStrategyProfile,
  guideNextConversationDetailed,
  LocalModelProvider
} from '../src/index.js';

const baseInput: ConversationInput = {
  conversationText: [
    '我：你周末一般会做什么？最近有没有发现好喝的咖啡？',
    '对方：我喜欢周末去找小咖啡店，上次喝到一杯桂花拿铁。',
    '我：听起来不错，我也喜欢咖啡，不过还没试过桂花味。',
    '对方：那家环境挺安静的，我有时候会在那里看书。',
    '我：我也喜欢安静一点的店，带本书坐一会儿挺舒服。',
    '对方：对，我最近在看一本旅行随笔，节奏很慢。'
  ].join('\n'),
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'natural'
};

async function localGuidance(overrides: Partial<ConversationInput> = {}) {
  const result = await guideNextConversationDetailed(
    { ...baseInput, ...overrides },
    {
      provider: new LocalModelProvider(),
      fallbackToLocal: false
    }
  );
  return result.guidance;
}

describe('strategy profiles', () => {
  it('defines a distinct policy for every relationship stage, goal, and tone', () => {
    const stagePolicies = relationshipStageEnum.options.map((relationshipStage) =>
      buildStrategyProfile({ ...baseInput, relationshipStage }).stagePolicy
    );
    const goalPolicies = goalEnum.options.map((goal) =>
      buildStrategyProfile({ ...baseInput, goal }).goalPolicy
    );
    const tonePolicies = userToneEnum.options.map((userTone) =>
      buildStrategyProfile({ ...baseInput, userTone }).tonePolicy
    );

    expect(stagePolicies.map((policy) => policy.selected)).toEqual(
      relationshipStageEnum.options
    );
    expect(goalPolicies.map((policy) => policy.selected)).toEqual(goalEnum.options);
    expect(tonePolicies.map((policy) => policy.selected)).toEqual(userToneEnum.options);
    expect(new Set(stagePolicies.map((policy) => JSON.stringify(policy))).size).toBe(6);
    expect(new Set(goalPolicies.map((policy) => JSON.stringify(policy))).size).toBe(7);
    expect(new Set(tonePolicies.map((policy) => JSON.stringify(policy))).size).toBe(5);

    expect(stagePolicies.find((policy) => policy.selected === 'just_met')?.allowedDepths)
      .toEqual(['light']);
    expect(stagePolicies.find((policy) => policy.selected === 'after_conflict')?.allowedDepths)
      .toEqual(['pause']);
    expect(tonePolicies.find((policy) => policy.selected === 'direct')?.emojiLimit)
      .toBe(0);
    expect(tonePolicies.find((policy) => policy.selected === 'playful')?.avoid.join('、'))
      .toMatch(/拒绝|冲突|安全风险/u);
  });
});

describe('deterministic strategy differentiation', () => {
  it('turns all seven goals into different drafts, bridges, and next steps', async () => {
    const results = new Map<Goal, Awaited<ReturnType<typeof localGuidance>>>();
    for (const goal of goalEnum.options) {
      results.set(goal, await localGuidance({ goal }));
    }

    const drafts = goalEnum.options.map(
      (goal) => results.get(goal)?.messageOptions[0]?.text
    );
    const bridges = goalEnum.options.map(
      (goal) => results.get(goal)?.topicBridges[0]?.to
    );
    const nextSteps = goalEnum.options.map((goal) => results.get(goal)?.nextStep);
    expect(new Set(drafts).size).toBe(goalEnum.options.length);
    expect(new Set(bridges).size).toBe(goalEnum.options.length);
    expect(new Set(nextSteps).size).toBe(goalEnum.options.length);

    expect(results.get('invite_to_meet')?.messageOptions[0]?.text)
      .toMatch(/一起|要不要|方便|周末/u);
    expect(results.get('invite_to_meet')?.messageOptions[0]?.text)
      .toMatch(/没关系|不方便|改期|直接说/u);
    expect(results.get('express_interest')?.messageOptions[0]?.text)
      .toMatch(/好感|舒服|开心|继续.*了解/u);
    expect(results.get('repair_misunderstanding')?.messageOptions[0]?.text)
      .toMatch(/不舒服|误会|抱歉|说清楚/u);
    expect(results.get('set_boundary')?.messageOptions[0]?.text)
      .toMatch(/不能接受|不接受|边界|不希望/u);
    expect(results.get('set_boundary')?.messageOptions[0]?.text)
      .toMatch(/结束|暂停/u);
  });

  it('writes five visibly different drafts instead of only changing style metadata', async () => {
    const results = new Map<UserTone, Awaited<ReturnType<typeof localGuidance>>>();
    for (const userTone of userToneEnum.options) {
      results.set(userTone, await localGuidance({ goal: 'invite_to_meet', userTone }));
    }

    const drafts = userToneEnum.options.map(
      (userTone) => results.get(userTone)?.messageOptions[0]?.text ?? ''
    );
    expect(new Set(drafts).size).toBe(userToneEnum.options.length);
    for (const userTone of userToneEnum.options) {
      expect(results.get(userTone)?.messageOptions[0]?.style).toBe(userTone);
    }
    expect(results.get('playful')?.messageOptions[0]?.text).toContain('😄');
    expect(results.get('direct')?.messageOptions[0]?.text).not.toMatch(/😄/u);
    expect(results.get('calm')?.messageOptions[0]?.text).not.toMatch(/😄/u);
    expect(
      (results.get('direct')?.messageOptions[0]?.text.length ?? 0)
    ).toBeLessThan(results.get('warm')?.messageOptions[0]?.text.length ?? 0);
  });

  it('lets relationship stage limit depth and override incompatible advancement goals', async () => {
    const justMet = await localGuidance({
      relationshipStage: 'just_met',
      goal: 'deepen_connection'
    });
    const longTerm = await localGuidance({
      relationshipStage: 'long_term_relationship',
      goal: 'deepen_connection'
    });
    const afterConflict = await localGuidance({
      relationshipStage: 'after_conflict',
      goal: 'invite_to_meet'
    });

    expect(justMet.recommendedDepth).toBe('light');
    expect(longTerm.recommendedDepth).toBe('vulnerable');
    expect(afterConflict.recommendedDepth).toBe('pause');
    expect(afterConflict.topicBridges[0]?.to).toBe('具体影响与修复意愿');
    expect(afterConflict.messageOptions[0]?.text).toMatch(/暂停|停一下|误会|缓冲/u);
    expect(afterConflict.messageOptions[0]?.text).not.toMatch(/一起|见面|约你|周末/u);
  });

  it('makes all six relationship stages visible in the resulting rationale and next step', async () => {
    const results = new Map<RelationshipStage, Awaited<ReturnType<typeof localGuidance>>>();
    for (const relationshipStage of relationshipStageEnum.options) {
      results.set(
        relationshipStage,
        await localGuidance({ relationshipStage, goal: 'keep_conversation_flowing' })
      );
    }

    const rationales = relationshipStageEnum.options.map(
      (relationshipStage) => results.get(relationshipStage)?.messageOptions[0]?.why
    );
    const nextSteps = relationshipStageEnum.options.map(
      (relationshipStage) => results.get(relationshipStage)?.nextStep
    );
    expect(new Set(rationales).size).toBe(relationshipStageEnum.options.length);
    expect(new Set(nextSteps).size).toBe(relationshipStageEnum.options.length);
  });

  it('keeps playful wording safe for conflict and boundary scenarios', async () => {
    const conflict = await localGuidance({
      relationshipStage: 'after_conflict',
      goal: 'invite_to_meet',
      userTone: 'playful'
    });
    const boundary = await localGuidance({
      goal: 'set_boundary',
      userTone: 'playful'
    });

    expect(conflict.messageOptions[0]?.style).toBe('playful');
    expect(conflict.messageOptions[0]?.text).toContain('不拿玩笑');
    expect(conflict.messageOptions[0]?.text).not.toMatch(/😄|哈哈/u);
    expect(boundary.messageOptions[0]?.style).toBe('playful');
    expect(boundary.messageOptions[0]?.text).toContain('认真');
    expect(boundary.messageOptions[0]?.text).not.toMatch(/😄|哈哈/u);
    expect(boundary.messageOptions[0]?.text).toMatch(/结束|暂停/u);
  });

  it.each(relationshipStageEnum.options)(
    'returns a valid local result for relationship stage %s',
    async (relationshipStage: RelationshipStage) => {
      await expect(localGuidance({ relationshipStage })).resolves.toMatchObject({
        risk: { level: 'low' }
      });
    }
  );
});
