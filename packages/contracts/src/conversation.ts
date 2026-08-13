import { z } from 'zod';

import { goalEnum, relationshipStageEnum, userToneEnum } from './enums.js';

function hasNoControlCharacters(value: string): boolean {
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  });
}

export const MAX_CONVERSATION_TEXT_LENGTH = 60_000;
/** Backward-compatible public form/API context budget. */
export const MAX_CONTEXT_LENGTH = 2_000;
/** Explicit alias for the public budget before internal voice metadata is added. */
export const MAX_USER_CONTEXT_LENGTH = MAX_CONTEXT_LENGTH;
/** Internal request budget, including trusted voice notes and the selected draft. */
export const MAX_INTERNAL_CONTEXT_LENGTH = 5_000;
export const VOICE_REFINEMENT_INTERNAL_START_SENTINEL =
  '[ALC_INTERNAL_VOICE_REFINEMENT_V1_START]';
export const VOICE_REFINEMENT_INTERNAL_END_SENTINEL =
  '[ALC_INTERNAL_VOICE_REFINEMENT_V1_END]';

export const AnalysisModelIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'analysisModelId 格式无效')
  .brand<'AnalysisModelId'>();
export type AnalysisModelId = z.infer<typeof AnalysisModelIdSchema>;
export const ANALYSIS_MODEL_AUTO_ID: AnalysisModelId = AnalysisModelIdSchema.parse('auto');

function conversationInputSchema(
  maximumContextLength: number,
  allowInternalVoiceContext: boolean
) {
  return z
    .object({
      conversationText: z
        .string()
        .trim()
        .min(40, 'conversationText 至少需要 40 个字符')
        .max(
          MAX_CONVERSATION_TEXT_LENGTH,
          `conversationText 最多允许 ${MAX_CONVERSATION_TEXT_LENGTH} 个字符`
        ),
      context: z
        .string()
        .trim()
        .max(
          maximumContextLength,
          `context 最多允许 ${maximumContextLength} 个字符`
        )
        .refine(
          (value) =>
            allowInternalVoiceContext ||
            (!value.includes(VOICE_REFINEMENT_INTERNAL_START_SENTINEL) &&
              !value.includes(VOICE_REFINEMENT_INTERNAL_END_SENTINEL)),
          'public context 不能包含内部语音块哨兵'
        )
        .optional(),
      relationshipStage: relationshipStageEnum,
      goal: goalEnum,
      userTone: userToneEnum
    })
    .strict();
}

/** Public REST/MCP and ordinary form input. */
export const ConversationInputSchema = conversationInputSchema(
  MAX_USER_CONTEXT_LENGTH,
  false
);

/** Server-owned Agent/voice context after trusted refinement metadata is added. */
export const InternalConversationInputSchema = conversationInputSchema(
  MAX_INTERNAL_CONTEXT_LENGTH,
  true
);

export type ConversationInput = z.infer<typeof ConversationInputSchema>;

export const GuidanceRequestSchema = ConversationInputSchema.extend({
  analysisModelId: AnalysisModelIdSchema.default(ANALYSIS_MODEL_AUTO_ID)
}).strict();

export const InternalGuidanceRequestSchema =
  InternalConversationInputSchema.extend({
    analysisModelId: AnalysisModelIdSchema.default(ANALYSIS_MODEL_AUTO_ID)
  }).strict();

export const AnalysisModelOptionSchema = z
  .object({
    id: AnalysisModelIdSchema,
    label: z.string().trim().min(1).max(80).refine(hasNoControlCharacters),
    description: z.string().trim().min(1).max(240).refine(hasNoControlCharacters),
    recommended: z.boolean()
  })
  .strict();

export const AnalysisModelCatalogSchema = z
  .object({
    defaultModelId: AnalysisModelIdSchema,
    models: z.array(AnalysisModelOptionSchema).min(1).max(9)
  })
  .strict()
  .superRefine((catalog, context) => {
    const ids = new Set<AnalysisModelId>();
    for (const [index, model] of catalog.models.entries()) {
      if (ids.has(model.id)) {
        context.addIssue({
          code: 'custom',
          path: ['models', index, 'id'],
          message: '模型 id 不可重复'
        });
      }
      ids.add(model.id);
    }
    if (!ids.has(ANALYSIS_MODEL_AUTO_ID)) {
      context.addIssue({
        code: 'custom',
        path: ['models'],
        message: '模型目录必须包含 auto'
      });
    }
    if (!ids.has(catalog.defaultModelId)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultModelId'],
        message: '默认模型必须存在于模型目录中'
      });
    }
    const recommendedModels = catalog.models.filter((model) => model.recommended);
    if (
      recommendedModels.length !== 1 ||
      recommendedModels[0]?.id !== catalog.defaultModelId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['models'],
        message: '模型目录必须只推荐默认模型'
      });
    }
  });

export type GuidanceRequest = z.infer<typeof GuidanceRequestSchema>;
export type InternalConversationInput = z.infer<
  typeof InternalConversationInputSchema
>;
export type InternalGuidanceRequest = z.infer<
  typeof InternalGuidanceRequestSchema
>;
export type AnalysisModelOption = z.infer<typeof AnalysisModelOptionSchema>;
export type AnalysisModelCatalog = z.infer<typeof AnalysisModelCatalogSchema>;
