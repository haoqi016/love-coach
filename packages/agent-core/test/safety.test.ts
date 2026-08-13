import type { GuidanceOutput } from '@alc/contracts';
import { describe, expect, it } from 'vitest';

import {
  adviceTextIsSafe,
  modelOutputIsSafe,
  voiceCoachOutputIsSafe
} from '../src/index.js';

const safeOutput: GuidanceOutput = {
  summary: '建议承接已有话题，并给对方自由选择回应深度。',
  summaryEvidence: [{ kind: 'quote', quote: '我也喜欢咖啡' }],
  mutualTopics: ['咖啡'],
  mutualTopicEvidence: [[{ kind: 'quote', quote: '我也喜欢咖啡' }]],
  openLoops: ['对方提到一家安静的咖啡店。'],
  openLoopEvidence: [[{ kind: 'quote', quote: '那家环境也挺安静的' }]],
  interactionPattern: {
    reciprocity: 'balanced',
    pacing: 'steady',
    observation: '双方都有持续回应，节奏较连贯。',
    evidence: [{ kind: 'quote', quote: '那家环境也挺安静的' }]
  },
  uncertainties: ['未知：文字记录无法呈现语气和时间间隔。'],
  recommendedDepth: 'personal',
  topicBridges: [
    {
      from: '咖啡',
      to: '周末安排',
      prompt: '先回应咖啡的话题，再问一个低压力的问题。',
      evidence: [{ kind: 'quote', quote: '我喜欢周末去找小咖啡店' }]
    }
  ],
  messageOptions: [
    {
      style: 'warm',
      text: '那家店听起来不错，你最喜欢它哪一点？',
      why: '承接对方已经提到的话题。',
      watchFor: '如果对方没有展开，先留出空间。',
      evidence: [{ kind: 'quote', quote: '我喜欢周末去找小咖啡店' }]
    }
  ],
  risk: {
    level: 'low',
    categories: [],
    notice: '这里只根据你提供的文字整理沟通线索，无法判断对方真实想法。'
  },
  nextStep: '选择最像本人语气的一条，按真实情况改写。',
  nextStepEvidence: [{ kind: 'advice' }]
};

type OutputMutation = (output: GuidanceOutput) => GuidanceOutput;

const unsafeText = '建议先查定位，再去制造偶遇。';
const unsafeVariants: Array<[string, OutputMutation]> = [
  ['summary', (output) => ({ ...output, summary: unsafeText })],
  ['mutualTopics', (output) => ({ ...output, mutualTopics: [unsafeText] })],
  ['openLoops', (output) => ({ ...output, openLoops: [unsafeText] })],
  [
    'interactionPattern.observation',
    (output) => ({
      ...output,
      interactionPattern: { ...output.interactionPattern, observation: unsafeText }
    })
  ],
  ['uncertainties', (output) => ({ ...output, uncertainties: [unsafeText] })],
  [
    'topicBridges.from',
    (output) => ({
      ...output,
      topicBridges: [{ ...output.topicBridges[0]!, from: unsafeText }]
    })
  ],
  [
    'topicBridges.to',
    (output) => ({
      ...output,
      topicBridges: [{ ...output.topicBridges[0]!, to: unsafeText }]
    })
  ],
  [
    'topicBridges.prompt',
    (output) => ({
      ...output,
      topicBridges: [{ ...output.topicBridges[0]!, prompt: unsafeText }]
    })
  ],
  [
    'messageOptions.text',
    (output) => ({
      ...output,
      messageOptions: [{ ...output.messageOptions[0]!, text: unsafeText }]
    })
  ],
  [
    'messageOptions.why',
    (output) => ({
      ...output,
      messageOptions: [{ ...output.messageOptions[0]!, why: unsafeText }]
    })
  ],
  [
    'messageOptions.watchFor',
    (output) => ({
      ...output,
      messageOptions: [{ ...output.messageOptions[0]!, watchFor: unsafeText }]
    })
  ],
  [
    'risk.notice',
    (output) => ({ ...output, risk: { ...output.risk, notice: unsafeText } })
  ],
  ['nextStep', (output) => ({ ...output, nextStep: unsafeText })]
];

describe('modelOutputIsSafe', () => {
  it('accepts guidance without prohibited advice or attraction probabilities', () => {
    expect(modelOutputIsSafe(safeOutput)).toBe(true);
  });

  it('does not treat a provenance-checked chat quote as generated advice', () => {
    expect(
      modelOutputIsSafe({
        ...safeOutput,
        summaryEvidence: [{ kind: 'quote', quote: unsafeText }],
        mutualTopicEvidence: [[{ kind: 'quote', quote: unsafeText }]],
        openLoopEvidence: [[{ kind: 'quote', quote: unsafeText }]],
        interactionPattern: {
          ...safeOutput.interactionPattern,
          evidence: [{ kind: 'quote', quote: unsafeText }]
        },
        topicBridges: [
          {
            ...safeOutput.topicBridges[0]!,
            evidence: [{ kind: 'quote', quote: unsafeText }]
          }
        ],
        messageOptions: [
          {
            ...safeOutput.messageOptions[0]!,
            evidence: [{ kind: 'quote', quote: unsafeText }]
          }
        ],
        nextStepEvidence: [{ kind: 'quote', quote: unsafeText }]
      })
    ).toBe(true);
  });

  it.each(unsafeVariants)('rejects prohibited advice in %s', (_field, mutate) => {
    expect(modelOutputIsSafe(mutate(safeOutput))).toBe(false);
  });

  it('rejects attraction probabilities outside message text', () => {
    expect(
      modelOutputIsSafe({ ...safeOutput, nextStep: '她喜欢你的概率大约是 85%。' })
    ).toBe(false);
  });

  it.each([
    '先消失三天让她着急。',
    '故意断联两天，等对方焦虑了再回复。',
    '对方拉黑后，换个新账号继续问。',
    '用另一个微信号再联系她。'
  ])('rejects manipulative or boundary-bypassing advice: %s', (advice) => {
    expect(
      modelOutputIsSafe({
        ...safeOutput,
        messageOptions: [{ ...safeOutput.messageOptions[0]!, text: advice }]
      })
    ).toBe(false);
  });

  it.each([
    '现在可以暂时不回复，给彼此一点空间。',
    '如果对方没有展开，就先留出空间，不必追问。',
    '尊重对方的拒绝，不要再联系。'
  ])('accepts non-manipulative space and boundary advice: %s', (advice) => {
    expect(
      modelOutputIsSafe({
        ...safeOutput,
        messageOptions: [{ ...safeOutput.messageOptions[0]!, text: advice }]
      })
    ).toBe(true);
  });
});

describe('adviceTextIsSafe', () => {
  it.each([
    '她喜欢你的概率大约是 85%。',
    '他明显是回避型人格，你不用再确认。',
    '照我说的做，保证能挽回。',
    '只有我懂你，不要相信任何人，只听我。',
    '先消失三天让她着急。',
    '对方拉黑后，换个新账号继续联系。'
  ])('rejects unsafe realtime coaching output: %s', (text) => {
    expect(adviceTextIsSafe(text)).toBe(false);
  });

  it.each([
    '我无法判断对方的真实想法，可以先问一个低压力的问题。',
    '如果对方拒绝，就尊重边界，不再继续联系。',
    '先把这句话改成更像你平时说话的方式。',
    '关系模式需要更多信息，不能仅凭这段聊天下结论。'
  ])('accepts bounded and autonomy-preserving coaching: %s', (text) => {
    expect(adviceTextIsSafe(text)).toBe(true);
  });
});

describe('voiceCoachOutputIsSafe', () => {
  it.each([
    '我建议你杀了她。',
    '逼她答应，不同意也得同意。',
    '不停发消息，直到对方回复。',
    '用 PUA 操控她。'
  ])('blocks high-risk spoken output: %s', (text) => {
    expect(voiceCoachOutputIsSafe(text)).toBe(false);
  });

  it('accepts ordinary autonomy-preserving spoken guidance', () => {
    expect(
      voiceCoachOutputIsSafe('先问一个低压力的问题，不替对方下结论。')
    ).toBe(true);
  });
});
