import { z } from 'zod';

import {
  pacingEnum,
  recommendedDepthEnum,
  reciprocityEnum,
  riskCategoryEnum,
  riskEnum,
  userToneEnum
} from './enums.js';

const ShortTextSchema = z.string().trim().min(1).max(500);

export const EvidenceBasisSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('quote'),
      quote: z.string().trim().min(1).max(120)
    })
    .strict(),
  z
    .object({
      kind: z.literal('advice')
    })
    .strict()
]);

export const EvidenceListSchema = z.array(EvidenceBasisSchema).min(1).max(3);
const EvidenceMatrixSchema = z.array(EvidenceListSchema).max(8);
const hasQuoteEvidence = (items: readonly z.infer<typeof EvidenceBasisSchema>[]): boolean =>
  items.some((basis) => basis.kind === 'quote');
const UncertaintySchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^(?:未知|待确认)[：:]/u, 'uncertainty 必须明确标注为未知或待确认');

export const InteractionPatternSchema = z
  .object({
    reciprocity: reciprocityEnum,
    pacing: pacingEnum,
    observation: ShortTextSchema,
    evidence: EvidenceListSchema
  })
  .strict();

export const TopicBridgeSchema = z
  .object({
    from: z.string().trim().min(1).max(120),
    to: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(400),
    evidence: EvidenceListSchema
  })
  .strict();

export const MessageOptionSchema = z
  .object({
    style: userToneEnum,
    text: z.string().trim().min(1).max(600),
    why: z.string().trim().min(1).max(400),
    watchFor: z.string().trim().min(1).max(400),
    evidence: EvidenceListSchema
  })
  .strict();

export const RiskAssessmentSchema = z
  .object({
    level: riskEnum,
    categories: z.array(riskCategoryEnum).max(9),
    notice: z.string().trim().min(1).max(800)
  })
  .strict();

export const GuidanceOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(800),
    summaryEvidence: EvidenceListSchema,
    mutualTopics: z.array(z.string().trim().min(1).max(120)).max(8),
    mutualTopicEvidence: EvidenceMatrixSchema,
    openLoops: z.array(z.string().trim().min(1).max(300)).max(8),
    openLoopEvidence: EvidenceMatrixSchema,
    interactionPattern: InteractionPatternSchema,
    uncertainties: z.array(UncertaintySchema).min(1).max(8),
    recommendedDepth: recommendedDepthEnum,
    topicBridges: z.array(TopicBridgeSchema).max(6),
    messageOptions: z.array(MessageOptionSchema).min(1).max(3),
    risk: RiskAssessmentSchema,
    nextStep: z.string().trim().min(1).max(600),
    nextStepEvidence: EvidenceListSchema
  })
  .strict()
  .superRefine((guidance, context) => {
    if (guidance.mutualTopics.length !== guidance.mutualTopicEvidence.length) {
      context.addIssue({
        code: 'custom',
        path: ['mutualTopicEvidence'],
        message: 'mutualTopicEvidence 必须与 mutualTopics 按索引一一对应'
      });
    }
    if (guidance.openLoops.length !== guidance.openLoopEvidence.length) {
      context.addIssue({
        code: 'custom',
        path: ['openLoopEvidence'],
        message: 'openLoopEvidence 必须与 openLoops 按索引一一对应'
      });
    }
    guidance.mutualTopicEvidence.forEach((evidence, index) => {
      if (!hasQuoteEvidence(evidence)) {
        context.addIssue({
          code: 'custom',
          path: ['mutualTopicEvidence', index],
          message: '共同话题必须至少引用一条聊天原文'
        });
      }
    });
    guidance.openLoopEvidence.forEach((evidence, index) => {
      if (!hasQuoteEvidence(evidence)) {
        context.addIssue({
          code: 'custom',
          path: ['openLoopEvidence', index],
          message: '未完线索必须至少引用一条聊天原文'
        });
      }
    });

    const safetyException =
      guidance.risk.level === 'high' || guidance.risk.level === 'crisis';
    if (!safetyException && !hasQuoteEvidence(guidance.summaryEvidence)) {
      context.addIssue({
        code: 'custom',
        path: ['summaryEvidence'],
        message: '常规总结必须至少引用一条聊天原文'
      });
    }
    if (
      !safetyException &&
      !hasQuoteEvidence(guidance.interactionPattern.evidence)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['interactionPattern', 'evidence'],
        message: '常规互动判断必须至少引用一条聊天原文'
      });
    }
  });

export type InteractionPattern = z.infer<typeof InteractionPatternSchema>;
export type EvidenceBasis = z.infer<typeof EvidenceBasisSchema>;
export type TopicBridge = z.infer<typeof TopicBridgeSchema>;
export type MessageOption = z.infer<typeof MessageOptionSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type GuidanceOutput = z.infer<typeof GuidanceOutputSchema>;
