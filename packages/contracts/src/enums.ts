import { z } from 'zod';

export const relationshipStageEnum = z.enum([
  'just_met',
  'getting_to_know',
  'dating',
  'exclusive_relationship',
  'long_term_relationship',
  'after_conflict'
]);

export const goalEnum = z.enum([
  'start_conversation',
  'keep_conversation_flowing',
  'deepen_connection',
  'invite_to_meet',
  'express_interest',
  'repair_misunderstanding',
  'set_boundary'
]);

export const userToneEnum = z.enum(['natural', 'warm', 'playful', 'direct', 'calm']);

export const riskEnum = z.enum(['low', 'caution', 'high', 'crisis']);

export const riskCategoryEnum = z.enum([
  'manipulation',
  'harassment',
  'coercion',
  'stalking',
  'sexual_pressure',
  'self_harm',
  'violence',
  'abuse',
  'privacy'
]);

export const recommendedDepthEnum = z.enum(['light', 'personal', 'vulnerable', 'pause']);

export const reciprocityEnum = z.enum(['balanced', 'user_leads', 'other_leads', 'limited_data']);

export const pacingEnum = z.enum(['steady', 'fast', 'slow', 'uneven', 'limited_data']);

export type RelationshipStage = z.infer<typeof relationshipStageEnum>;
export type Goal = z.infer<typeof goalEnum>;
export type UserTone = z.infer<typeof userToneEnum>;
export type RiskLevel = z.infer<typeof riskEnum>;
export type RiskCategory = z.infer<typeof riskCategoryEnum>;
export type RecommendedDepth = z.infer<typeof recommendedDepthEnum>;
export type Reciprocity = z.infer<typeof reciprocityEnum>;
export type Pacing = z.infer<typeof pacingEnum>;
