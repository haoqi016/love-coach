import type {
  ConversationInput,
  GuidanceOutput,
  RiskAssessment,
  RiskCategory,
  RiskLevel
} from '@alc/contracts';

interface SafetyRule {
  readonly category: RiskCategory;
  readonly pattern: RegExp;
}

export interface SafetyAssessment extends RiskAssessment {
  readonly blockNormalGuidance: boolean;
}

const CRISIS_RULES: readonly SafetyRule[] = [
  {
    category: 'self_harm',
    pattern: /自杀|不想活|结束生命|割腕|跳楼|活不下去|伤害自己/u
  },
  {
    category: 'violence',
    pattern: /杀了(?:他|她|对方)|打死|带刀|伤害(?:他|她|对方)|暴力报复/u
  }
];

const BLOCKED_RULES: readonly SafetyRule[] = [
  {
    category: 'manipulation',
    pattern: /PUA|拿捏|操控|精神控制|让.{0,8}离不开|制造嫉妒|欲擒故纵|情感套路/u
  },
  {
    category: 'harassment',
    pattern: /死缠烂打|不停(?:发|打电话)|换小号联系|拉黑后.{0,8}联系/u
  },
  {
    category: 'coercion',
    pattern: /绕过拒绝|逼(?:他|她|对方).{0,8}答应|不同意也得|威胁.{0,8}同意/u
  },
  {
    category: 'stalking',
    pattern: /跟踪|蹲守|查定位|偷偷定位|监控(?:他|她|对方)|查手机/u
  },
  {
    category: 'sexual_pressure',
    pattern: /灌醉|强迫.{0,8}(?:性|发生关系)|逼.{0,8}(?:裸照|发生关系)|性胁迫/u
  }
];

const CAUTION_RULES: readonly SafetyRule[] = [
  {
    category: 'abuse',
    pattern: /家暴|打我|掐我|威胁我|限制我出门|没收我手机/u
  },
  {
    category: 'privacy',
    pattern: /身份证号|家庭住址|手机号|微信号|裸照/u
  }
];

function matchingCategories(text: string, rules: readonly SafetyRule[]): RiskCategory[] {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.category);
}

function uniqueCategories(categories: readonly RiskCategory[]): RiskCategory[] {
  return [...new Set(categories)];
}

function noticeFor(level: RiskLevel, categories: readonly RiskCategory[]): string {
  if (level === 'crisis') {
    return '这段内容可能涉及立即的人身危险。请先停止关系推进或消息措辞设计，联系可信任的人陪伴；若危险正在发生，请立即联系当地紧急服务。';
  }

  if (categories.includes('abuse')) {
    return '这段内容可能涉及暴力或控制。优先考虑自身安全、保存必要证据，并联系可信任的人或当地专业支持；不要独自进行可能升级风险的对质。';
  }

  if (level === 'high') {
    return '我不能帮助操控、跟踪、骚扰、绕过拒绝或施加性压力。亲密关系必须建立在明确同意、尊重拒绝和可自由退出的基础上。';
  }

  if (categories.includes('privacy')) {
    return '聊天中可能包含隐私信息。分析前请遮挡姓名、头像、账号、电话、地址和其他可识别信息。';
  }

  return '这里只根据你提供的文字整理沟通线索，无法判断对方真实想法，也不会给出好感概率。';
}

export function assessTextSafety(text: string): SafetyAssessment {
  const crisis = matchingCategories(text, CRISIS_RULES);
  const blocked = matchingCategories(text, BLOCKED_RULES);
  const caution = matchingCategories(text, CAUTION_RULES);
  const categories = uniqueCategories([...crisis, ...blocked, ...caution]);

  let level: RiskLevel = 'low';
  if (crisis.length > 0) {
    level = 'crisis';
  } else if (blocked.length > 0 || caution.includes('abuse')) {
    level = 'high';
  } else if (caution.length > 0) {
    level = 'caution';
  }

  return {
    level,
    categories,
    notice: noticeFor(level, categories),
    blockNormalGuidance: level === 'high' || level === 'crisis'
  };
}

export function assessInputSafety(input: ConversationInput): SafetyAssessment {
  return assessTextSafety(`${input.context ?? ''}\n${input.conversationText}`);
}

const ATTRACTION_PROBABILITY = /(?:好感|喜欢|爱上)(?:度|概率)?[^。！？\n]{0,12}\d{1,3}%|\d{1,3}%[^。！？\n]{0,12}(?:好感|喜欢|爱上)/u;
const PROHIBITED_ADVICE_RULES: readonly RegExp[] = [
  /假装冷淡|故意不回|制造嫉妒|跟踪(?:他|她|对方)|查定位|死缠烂打|灌醉|强迫.{0,8}(?:性|发生关系)/u,
  /(?:先|故意|刻意)(?:消失|断联|冷处理)[^。！？\n]{0,16}(?:让|等)(?:他|她|对方)?[^。！？\n]{0,6}(?:着急|焦虑|不安|担心|慌)/u,
  /(?:换|用|注册)(?:个|一个|另一个)?(?:新|新的)?(?:账号|帐号|小号|号码|手机号|微信号)[^。！？\n]{0,12}(?:继续|再)[^。！？\n]{0,8}(?:问|联系|发消息|私信|添加)/u
];
const PROHIBITED_COACHING_RULES: readonly RegExp[] = [
  /(?:他|她|对方|你)(?:就是|一定是|明显是)[^。！？\n]{0,10}(?:NPD|自恋型人格|回避型人格|依恋障碍|人格障碍)/iu,
  /(?:保证|肯定能|一定能)[^。！？\n]{0,12}(?:复合|挽回|追到|让.{0,6}(?:喜欢|爱上)|脱单)/u,
  /(?:只有|只剩)(?:我|这个助手|本助手)[^。！？\n]{0,10}(?:懂你|能帮你|值得相信)|不要相信任何人[^。！？\n]{0,8}(?:只听|听)(?:我|这个助手)/u
];

/**
 * Conservative, deterministic screening for generated relationship advice.
 * This is suitable for both structured guidance and realtime transcript
 * defense-in-depth; it is not a substitute for a trusted server-side gate.
 */
export function adviceTextIsSafe(text: string): boolean {
  return (
    !ATTRACTION_PROBABILITY.test(text) &&
    !PROHIBITED_ADVICE_RULES.some((pattern) => pattern.test(text)) &&
    !PROHIBITED_COACHING_RULES.some((pattern) => pattern.test(text))
  );
}

/** Realtime spoken-output screen, intentionally stricter than structured guidance. */
export function voiceCoachOutputIsSafe(text: string): boolean {
  return adviceTextIsSafe(text) && !assessTextSafety(text).blockNormalGuidance;
}

function collectTextValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => collectTextValues(item));
  }

  if (value !== null && typeof value === 'object') {
    if (
      'kind' in value &&
      value.kind === 'quote' &&
      'quote' in value
    ) {
      return [];
    }
    return Object.values(value).flatMap((item: unknown) => collectTextValues(item));
  }

  return [];
}

export function modelOutputIsSafe(output: GuidanceOutput): boolean {
  const allText = collectTextValues(output).join('\n');
  return adviceTextIsSafe(allText);
}
