import {
  VoiceTurnSafetyRequestSchema,
  VoiceTurnSafetyResponseSchema,
  type RiskAssessment,
  type VoiceTurnSafetyResponse
} from '@alc/contracts';

import { assessTextSafety } from './safety.js';

const FIRST_PERSON_UNDER_18 =
  /(?:我|本人)(?:今年|现在)?(?:才|只有|是)?\s*(?:[0-9]|1[0-7]|[一二三四五六七八九]|十(?:[一二三四五六七])?)\s*岁/u;
const EXPLICIT_MINOR_DISCLOSURE =
  /(?:我|本人).{0,8}(?:未满(?:18|十八)岁|未成年(?:人)?)/u;

const ADULT_CONFIRMATION_REQUIRED =
  '实时恋爱语音教练仅面向 18 岁及以上用户。请先完成年龄确认；你仍可继续使用一般文字沟通与安全支持。';
const UNDER_18_RESPONSE =
  '实时恋爱语音教练仅面向 18 岁及以上用户。我会停止恋爱推进建议；你仍可使用一般沟通与安全支持。如涉及威胁、性压力或人身安全，请联系可信任的成年人。';
const CRISIS_SUFFIX =
  '本应用无法代你联系紧急服务；若危险正在发生，请立即联系当地紧急服务或请身边可信任的人协助。';

function publicRisk(
  safety: ReturnType<typeof assessTextSafety>
): RiskAssessment {
  return {
    level: safety.level,
    categories: safety.categories,
    notice: safety.notice
  };
}

function disclosesUnder18(transcript: string): boolean {
  return (
    FIRST_PERSON_UNDER_18.test(transcript) ||
    EXPLICIT_MINOR_DISCLOSURE.test(transcript)
  );
}

/** Lease-independent deterministic gate for completed transcript text. */
export function voiceTurnTextIsSafe(transcript: string): boolean {
  const normalizedTranscript = transcript.replace(/\s+/gu, '');
  return (
    !assessTextSafety(normalizedTranscript).blockNormalGuidance &&
    !disclosesUnder18(normalizedTranscript)
  );
}

export function assessVoiceTurnSafety(input: unknown): VoiceTurnSafetyResponse {
  const request = VoiceTurnSafetyRequestSchema.parse(input);
  const normalizedTranscript = request.transcript.replace(/\s+/gu, '');
  const risk = publicRisk(assessTextSafety(normalizedTranscript));

  if (risk.level === 'crisis') {
    return VoiceTurnSafetyResponseSchema.parse({
      action: 'safety_stop',
      reason: 'crisis',
      risk,
      responseText: `${risk.notice}${CRISIS_SUFFIX}`
    });
  }

  if (risk.level === 'high') {
    return VoiceTurnSafetyResponseSchema.parse({
      action: 'safety_stop',
      reason: 'high_risk',
      risk,
      responseText: risk.notice
    });
  }

  if (disclosesUnder18(normalizedTranscript)) {
    return VoiceTurnSafetyResponseSchema.parse({
      action: 'safety_stop',
      reason: 'under_18',
      risk,
      responseText: UNDER_18_RESPONSE
    });
  }

  if (!request.adultConfirmed) {
    return VoiceTurnSafetyResponseSchema.parse({
      action: 'safety_stop',
      reason: 'adult_confirmation_required',
      risk,
      responseText: ADULT_CONFIRMATION_REQUIRED
    });
  }

  return VoiceTurnSafetyResponseSchema.parse({
    action: 'allow',
    reason: risk.level === 'caution' ? 'caution' : 'low',
    risk
  });
}
