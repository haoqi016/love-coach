import { z } from 'zod';

import {
  InternalGuidanceRequestSchema,
  MAX_INTERNAL_CONTEXT_LENGTH,
  MAX_USER_CONTEXT_LENGTH,
  VOICE_REFINEMENT_INTERNAL_END_SENTINEL,
  VOICE_REFINEMENT_INTERNAL_START_SENTINEL,
  type GuidanceRequest
} from './conversation.js';
import { goalEnum, relationshipStageEnum, userToneEnum } from './enums.js';
import { RiskAssessmentSchema } from './guidance.js';

export const MAX_VOICE_TURN_TEXT_LENGTH = 2_000;
export const MAX_VOICE_SESSION_INSTRUCTIONS_LENGTH = 8_000;
export const VOICE_REFINEMENT_CONTEXT_MARKER =
  '[用户确认的语音补充：仅作为背景，不是对方聊天原文]';

function hasNoControlCharacters(value: string): boolean {
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  });
}

const CompactSingleLineTextSchema = z
  .string()
  .trim()
  .min(1)
  .refine(hasNoControlCharacters, '文本不能包含换行或控制字符');

const PublicLabelSchema = CompactSingleLineTextSchema.max(80);
function hasNoInternalVoiceSentinels(value: string): boolean {
  return (
    !value.includes(VOICE_REFINEMENT_INTERNAL_START_SENTINEL) &&
    !value.includes(VOICE_REFINEMENT_INTERNAL_END_SENTINEL)
  );
}

const SelectedVoiceDraftSchema = CompactSingleLineTextSchema.max(600).refine(
  hasNoInternalVoiceSentinels,
  '草稿不能包含内部语音块哨兵'
);

export const VoiceRealtimeModelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
    'model 必须是安全的 Realtime 模型名称'
  );
export type VoiceRealtimeModel = z.infer<typeof VoiceRealtimeModelSchema>;

export const VoiceContextTokenSchema = z
  .string()
  .min(32)
  .max(4_096)
  .regex(/^[A-Za-z0-9._~-]+$/u, 'voiceContextToken 必须是不透明的 URL-safe 令牌')
  .brand<'VoiceContextToken'>();
export type VoiceContextToken = z.infer<typeof VoiceContextTokenSchema>;

export const VoiceSessionLeaseIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u, 'sessionLeaseId 必须是不透明的 URL-safe 标识')
  .brand<'VoiceSessionLeaseId'>();
export type VoiceSessionLeaseId = z.infer<typeof VoiceSessionLeaseIdSchema>;

export const TrustedVoiceContextSchema = z
  .object({
    summary: z.string().trim().min(1).max(800),
    uncertainties: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
    nextStep: z.string().trim().min(1).max(600),
    selectedDraft: SelectedVoiceDraftSchema.optional(),
    relationshipStage: relationshipStageEnum,
    goal: goalEnum,
    userTone: userToneEnum,
    risk: RiskAssessmentSchema
  })
  .strict()
  .superRefine((context, refinementContext) => {
    if (context.risk.level === 'high' || context.risk.level === 'crisis') {
      refinementContext.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: 'high/crisis 风险不能创建普通语音教练上下文'
      });
    }
    if (context.risk.level === 'low' && context.risk.categories.length > 0) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['risk', 'categories'],
        message: 'low 风险不能包含风险类别'
      });
    }
    if (
      context.risk.level === 'caution' &&
      context.risk.categories.some((category) => category !== 'privacy')
    ) {
      refinementContext.addIssue({
        code: 'custom',
        path: ['risk', 'categories'],
        message: '当前 caution 语音上下文只允许 privacy 风险类别'
      });
    }
  });
export type TrustedVoiceContext = z.infer<typeof TrustedVoiceContextSchema>;

export const VoiceCapabilitiesSchema = z.discriminatedUnion('enabled', [
  z.object({ enabled: z.literal(false) }).strict(),
  z
    .object({
      enabled: z.literal(true),
      modelLabel: PublicLabelSchema,
      voiceLabel: PublicLabelSchema,
      maxSessionSeconds: z.number().int().min(30).max(300)
    })
    .strict()
]);
export type VoiceCapabilities = z.infer<typeof VoiceCapabilitiesSchema>;

export const VoiceSessionRequestSchema = z
  .object({
    voiceContextToken: VoiceContextTokenSchema,
    selectedDraft: SelectedVoiceDraftSchema,
    adultConfirmed: z.literal(true)
  })
  .strict();
export type VoiceSessionRequest = z.infer<typeof VoiceSessionRequestSchema>;

export const VoiceSessionResponseSchema = z
  .object({
    clientSecret: z.string().min(1).max(4_096),
    expiresAt: z.number().int().positive(),
    sessionLeaseId: VoiceSessionLeaseIdSchema,
    model: VoiceRealtimeModelSchema,
    transcriptionModel: VoiceRealtimeModelSchema,
    voice: VoiceRealtimeModelSchema,
    sessionInstructions: z
      .string()
      .trim()
      .min(1)
      .max(MAX_VOICE_SESSION_INSTRUCTIONS_LENGTH),
    modelLabel: PublicLabelSchema,
    voiceLabel: PublicLabelSchema,
    maxSessionSeconds: z.number().int().min(30).max(300)
  })
  .strict();
export type VoiceSessionResponse = z.infer<typeof VoiceSessionResponseSchema>;

export const VoiceEndRequestSchema = z
  .object({ sessionLeaseId: VoiceSessionLeaseIdSchema })
  .strict();
export type VoiceEndRequest = z.infer<typeof VoiceEndRequestSchema>;

export const VoiceRefinementNoteKindSchema = z.enum([
  'goal',
  'feeling',
  'concern',
  'boundary',
  'tone_preference',
  'other'
]);
export type VoiceRefinementNoteKind = z.infer<
  typeof VoiceRefinementNoteKindSchema
>;

export const VoiceRefinementNoteSchema = z
  .object({
    kind: VoiceRefinementNoteKindSchema,
    value: CompactSingleLineTextSchema.max(240).refine(
      hasNoInternalVoiceSentinels,
      '语音补充不能包含内部语音块哨兵'
    ),
    confirmed: z.literal(true)
  })
  .strict();
export type VoiceRefinementNote = z.infer<typeof VoiceRefinementNoteSchema>;

const VOICE_REFINEMENT_NOTE_LABELS: Readonly<
  Record<VoiceRefinementNoteKind, string>
> = {
  goal: '目标',
  feeling: '感受',
  concern: '担忧',
  boundary: '边界',
  tone_preference: '语气偏好',
  other: '其他补充'
};

const MAX_MERGED_VOICE_REFINEMENT_NOTES = 8;
const SELECTED_DRAFT_LINE_PREFIX = '- 用户选中的旧草稿：';
const EXPLICIT_VOICE_CORRECTION =
  /(?:刚才.{0,8}(?:听错|识别错|说错)|更正|纠正|不是.{1,40}(?:而是|是))/u;

interface ParsedHistoricalVoiceNote {
  readonly note: VoiceRefinementNote;
  readonly correction: boolean;
}

interface ParsedExistingVoiceContext {
  readonly originalContext: string | undefined;
  readonly notes: readonly ParsedHistoricalVoiceNote[];
}

type ParsedVoiceBlockLine =
  | {
      readonly type: 'note';
      readonly note: VoiceRefinementNote;
      readonly correction: boolean;
    }
  | { readonly type: 'selected_draft' };

interface MergedVoiceNote {
  readonly note: VoiceRefinementNote;
  readonly current: boolean;
  correction: boolean;
}

function parseVoiceBlockLine(line: string): ParsedVoiceBlockLine | undefined {
  if (line.startsWith(SELECTED_DRAFT_LINE_PREFIX)) {
    const selectedDraft = line.slice(SELECTED_DRAFT_LINE_PREFIX.length);
    return SelectedVoiceDraftSchema.safeParse(selectedDraft).success
      ? { type: 'selected_draft' }
      : undefined;
  }

  const match =
    /^- ?(?:(历史补充|本轮补充|历史更正|本轮更正)·)?([^：]+)：(.+)$/u.exec(line);
  if (!match) return undefined;
  const temporalLabel = match[1];
  const label = match[2];
  const value = match[3];
  const kind = (
    Object.entries(VOICE_REFINEMENT_NOTE_LABELS) as Array<
      [VoiceRefinementNoteKind, string]
    >
  ).find((entry) => entry[1] === label)?.[0];
  if (!kind || value === undefined) return undefined;

  const parsed = VoiceRefinementNoteSchema.safeParse({
    kind,
    value,
    confirmed: true
  });
  return parsed.success
    ? {
        type: 'note',
        note: parsed.data,
        correction:
          temporalLabel?.endsWith('更正') === true ||
          EXPLICIT_VOICE_CORRECTION.test(parsed.data.value)
      }
    : undefined;
}

function parseInternalVoiceBlock(
  block: string
): readonly ParsedHistoricalVoiceNote[] | undefined {
  const lines = block.split(/\r?\n/u);
  if (
    lines[0] !== VOICE_REFINEMENT_INTERNAL_START_SENTINEL ||
    lines[1] !== VOICE_REFINEMENT_CONTEXT_MARKER ||
    lines.at(-1) !== VOICE_REFINEMENT_INTERNAL_END_SENTINEL
  ) {
    return undefined;
  }

  const notes: ParsedHistoricalVoiceNote[] = [];
  const blockLines = lines.slice(2, -1);
  let selectedDraftCount = 0;
  for (const [index, rawLine] of blockLines.entries()) {
    const line = rawLine.trim();
    if (!line) return undefined;
    const parsedLine = parseVoiceBlockLine(line);
    if (!parsedLine) return undefined;
    if (parsedLine.type === 'selected_draft') {
      selectedDraftCount += 1;
      if (index !== blockLines.length - 1) return undefined;
    } else {
      notes.push({
        note: parsedLine.note,
        correction: parsedLine.correction
      });
    }
  }
  return selectedDraftCount === 1 && notes.length > 0 ? notes : undefined;
}

function parseExistingVoiceContext(
  originalContext: string | undefined
): ParsedExistingVoiceContext {
  const normalized = originalContext?.trim();
  if (!normalized) return { originalContext: undefined, notes: [] };

  const startCount = normalized.split(
    VOICE_REFINEMENT_INTERNAL_START_SENTINEL
  ).length - 1;
  const endCount = normalized.split(
    VOICE_REFINEMENT_INTERNAL_END_SENTINEL
  ).length - 1;
  if (startCount === 0 && endCount === 0) {
    if (normalized.length > MAX_USER_CONTEXT_LENGTH) {
      throw new RangeError(
        `原始用户 context 最多允许 ${MAX_USER_CONTEXT_LENGTH} 个字符`
      );
    }
    return { originalContext: normalized, notes: [] };
  }
  if (startCount !== 1 || endCount !== 1) {
    throw new RangeError('语音 context 只能包含一个完整的内部语音块');
  }

  const startIndex = normalized.indexOf(
    VOICE_REFINEMENT_INTERNAL_START_SENTINEL
  );
  const prefix = normalized.slice(0, startIndex);
  const separatorLength =
    startIndex === 0
      ? 0
      : prefix.endsWith('\r\n\r\n')
        ? 4
        : prefix.endsWith('\n\n')
          ? 2
          : undefined;
  const notes = parseInternalVoiceBlock(normalized.slice(startIndex));
  if (separatorLength === undefined || !notes) {
    throw new RangeError('内部语音块必须是 context 末尾的完整 canonical block');
  }
  const preservedContext = normalized.slice(0, startIndex - separatorLength);
  if (preservedContext.length > MAX_USER_CONTEXT_LENGTH) {
    throw new RangeError(
      `原始用户 context 最多允许 ${MAX_USER_CONTEXT_LENGTH} 个字符`
    );
  }
  return {
    originalContext: preservedContext || undefined,
    notes
  };
}

function voiceNoteKey(note: VoiceRefinementNote): string {
  return `${note.kind}\u0000${note.value}`;
}

function mergeVoiceNotes(
  existingNotes: readonly ParsedHistoricalVoiceNote[],
  currentNotes: readonly VoiceRefinementNote[]
): MergedVoiceNote[] {
  const candidates: MergedVoiceNote[] = [
    ...existingNotes.map(({ note, correction }) => ({
      note,
      correction,
      current: false
    })),
    ...currentNotes.map((note) => ({
      note: VoiceRefinementNoteSchema.parse(note),
      correction: EXPLICIT_VOICE_CORRECTION.test(note.value),
      current: true
    }))
  ];
  const seen = new Set<string>();
  const chosenByKey = new Map<string, MergedVoiceNote>();
  const deduplicatedNewestFirst: MergedVoiceNote[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    const key = voiceNoteKey(candidate.note);
    if (seen.has(key)) {
      const chosen = chosenByKey.get(key);
      if (chosen && candidate.correction) chosen.correction = true;
      continue;
    }
    seen.add(key);
    chosenByKey.set(key, candidate);
    deduplicatedNewestFirst.push(candidate);
  }
  const merged = deduplicatedNewestFirst.reverse();

  while (merged.length > MAX_MERGED_VOICE_REFINEMENT_NOTES) {
    const oldestPlainHistoricalIndex = merged.findIndex(
      (item) => !item.current && !item.correction
    );
    const oldestHistoricalIndex =
      oldestPlainHistoricalIndex >= 0
        ? oldestPlainHistoricalIndex
        : merged.findIndex((item) => !item.current);
    if (oldestHistoricalIndex < 0) {
      throw new RangeError(
        `当前轮语音补充最多允许 ${MAX_MERGED_VOICE_REFINEMENT_NOTES} 条，不会自动丢弃当前轮内容`
      );
    }
    merged.splice(oldestHistoricalIndex, 1);
  }
  return merged;
}

function renderVoiceRefinementContext(
  originalContext: string | undefined,
  notes: readonly MergedVoiceNote[],
  selectedDraft: string | undefined
): string {
  const voiceLines = notes.map(
    ({ note, current, correction }) => {
      const temporalLabel = current
        ? correction
          ? '本轮更正'
          : '本轮补充'
        : correction
          ? '历史更正'
          : '历史补充';
      return `- ${temporalLabel}·${VOICE_REFINEMENT_NOTE_LABELS[note.kind]}：${note.value}`;
    }
  );
  if (selectedDraft !== undefined) {
    voiceLines.push(`${SELECTED_DRAFT_LINE_PREFIX}${selectedDraft}`);
  }
  const voiceBlock = [
    VOICE_REFINEMENT_INTERNAL_START_SENTINEL,
    VOICE_REFINEMENT_CONTEXT_MARKER,
    ...voiceLines,
    VOICE_REFINEMENT_INTERNAL_END_SENTINEL
  ].join('\n');
  return originalContext ? `${originalContext}\n\n${voiceBlock}` : voiceBlock;
}

export function mergeVoiceRefinementContext(
  originalContext: string | undefined,
  notes: readonly VoiceRefinementNote[],
  selectedDraft?: string
): string {
  const existing = parseExistingVoiceContext(originalContext);
  const normalizedSelectedDraft =
    selectedDraft === undefined
      ? undefined
      : SelectedVoiceDraftSchema.parse(selectedDraft);
  const mergedNotes = mergeVoiceNotes(existing.notes, notes);
  let merged = renderVoiceRefinementContext(
    existing.originalContext,
    mergedNotes,
    normalizedSelectedDraft
  );

  while (merged.length > MAX_INTERNAL_CONTEXT_LENGTH) {
    const oldestPlainHistoricalIndex = mergedNotes.findIndex(
      (item) => !item.current && !item.correction
    );
    const oldestHistoricalIndex =
      oldestPlainHistoricalIndex >= 0
        ? oldestPlainHistoricalIndex
        : mergedNotes.findIndex((item) => !item.current);
    if (oldestHistoricalIndex < 0) {
      throw new RangeError(
        `合并后的 context 最多允许 ${MAX_INTERNAL_CONTEXT_LENGTH} 个字符；已优先丢弃最旧的历史语音补充，但不会自动丢弃原 context 或当前轮语音补充`
      );
    }
    mergedNotes.splice(oldestHistoricalIndex, 1);
    merged = renderVoiceRefinementContext(
      existing.originalContext,
      mergedNotes,
      normalizedSelectedDraft
    );
  }

  return merged;
}

const VoiceRefinementRequestBaseSchema = z
  .object({
    originalRequest: InternalGuidanceRequestSchema,
    notes: z.array(VoiceRefinementNoteSchema).min(1).max(8),
    selectedDraft: SelectedVoiceDraftSchema
  })
  .strict();

export const VoiceRefinementRequestSchema =
  VoiceRefinementRequestBaseSchema.superRefine((request, context) => {
    try {
      mergeVoiceRefinementContext(
        request.originalRequest.context,
        request.notes,
        request.selectedDraft
      );
    } catch (error: unknown) {
      if (error instanceof RangeError) {
        context.addIssue({
          code: 'custom',
          path: ['notes'],
          message: error.message
        });
      }
    }
  });
export type VoiceRefinementRequest = z.infer<
  typeof VoiceRefinementRequestSchema
>;

export function toGuidanceRequestWithVoiceRefinement(
  input: unknown
): GuidanceRequest {
  const request = VoiceRefinementRequestSchema.parse(input);
  const context = mergeVoiceRefinementContext(
    request.originalRequest.context,
    request.notes,
    request.selectedDraft
  );

  return InternalGuidanceRequestSchema.parse({
    ...request.originalRequest,
    context
  });
}

export const VoiceTurnSafetyActionSchema = z.enum(['allow', 'safety_stop']);
export type VoiceTurnSafetyAction = z.infer<
  typeof VoiceTurnSafetyActionSchema
>;

export const VoiceTurnSafetyReasonSchema = z.enum([
  'low',
  'caution',
  'adult_confirmation_required',
  'under_18',
  'high_risk',
  'crisis'
]);
export type VoiceTurnSafetyReason = z.infer<
  typeof VoiceTurnSafetyReasonSchema
>;

export const VoiceTurnSafetyRequestSchema = z
  .object({
    sessionLeaseId: VoiceSessionLeaseIdSchema,
    transcript: z
      .string()
      .trim()
      .min(1)
      .max(MAX_VOICE_TURN_TEXT_LENGTH),
    adultConfirmed: z.boolean()
  })
  .strict();
export type VoiceTurnSafetyRequest = z.infer<
  typeof VoiceTurnSafetyRequestSchema
>;

export const VoiceTurnSafetyResponseSchema = z
  .discriminatedUnion('action', [
    z
      .object({
        action: z.literal('allow'),
        reason: z.enum(['low', 'caution']),
        risk: RiskAssessmentSchema
      })
      .strict(),
    z
      .object({
        action: z.literal('safety_stop'),
        reason: z.enum([
          'adult_confirmation_required',
          'under_18',
          'high_risk',
          'crisis'
        ]),
        risk: RiskAssessmentSchema,
        responseText: z.string().trim().min(1).max(1_000)
      })
      .strict()
  ])
  .superRefine((response, context) => {
    if (response.reason === 'low' && response.risk.level !== 'low') {
      context.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: 'low 结果必须携带 low 风险'
      });
    }
    if (response.reason === 'caution' && response.risk.level !== 'caution') {
      context.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: 'caution 结果必须携带 caution 风险'
      });
    }
    if (response.reason === 'high_risk' && response.risk.level !== 'high') {
      context.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: 'high_risk 结果必须携带 high 风险'
      });
    }
    if (response.reason === 'crisis' && response.risk.level !== 'crisis') {
      context.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: 'crisis 结果必须携带 crisis 风险'
      });
    }
    if (
      (response.reason === 'adult_confirmation_required' ||
        response.reason === 'under_18') &&
      response.risk.level !== 'low' &&
      response.risk.level !== 'caution'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['risk', 'level'],
        message: '年龄限制结果不能掩盖 high/crisis 风险'
      });
    }
  });
export type VoiceTurnSafetyResponse = z.infer<
  typeof VoiceTurnSafetyResponseSchema
>;
