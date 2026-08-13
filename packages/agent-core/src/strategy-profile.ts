import type {
  ConversationInput,
  Goal,
  RecommendedDepth,
  RelationshipStage,
  UserTone
} from '@alc/contracts';

export interface StagePolicy {
  readonly selected: RelationshipStage;
  readonly allowedDepths: readonly RecommendedDepth[];
  readonly pacing: string;
  readonly requiredMoves: readonly string[];
  readonly avoid: readonly string[];
}

export interface GoalPolicy {
  readonly selected: Goal;
  readonly objective: string;
  readonly requiredMoves: readonly string[];
  readonly avoid: readonly string[];
}

export interface TonePolicy {
  readonly selected: UserTone;
  readonly sentenceLength: string;
  readonly directness: string;
  readonly emojiLimit: 0 | 1;
  readonly requiredSignals: readonly string[];
  readonly avoid: readonly string[];
}

export interface StrategyProfile {
  readonly priority: readonly [
    'authoritativeRisk_and_evidence',
    'stagePolicy',
    'goalPolicy',
    'tonePolicy'
  ];
  readonly stagePolicy: StagePolicy;
  readonly goalPolicy: GoalPolicy;
  readonly tonePolicy: TonePolicy;
}

type StagePolicyDefinition = Omit<StagePolicy, 'selected'>;
type GoalPolicyDefinition = Omit<GoalPolicy, 'selected'>;
type TonePolicyDefinition = Omit<TonePolicy, 'selected'>;

const STAGE_POLICIES = {
  just_met: {
    allowedDepths: ['light'],
    pacing: '一次只做一个低压力动作，优先围绕公开、具体的日常线索。',
    requiredMoves: ['降低回答负担', '允许对方不回复或稍后回复'],
    avoid: ['突然表白', '追问关系定义', '高强度自我暴露', '连续私人问题']
  },
  getting_to_know: {
    allowedDepths: ['light', 'personal'],
    pacing: '每次只比当前聊天深入一小步，用轻量自我分享换取对等交流。',
    requiredMoves: ['承接对方明确提到的偏好或经历', '为对方保留选择回应深度的空间'],
    avoid: ['突然讨论承诺', '连续追问私人信息', '把礼貌回应解释为好感']
  },
  dating: {
    allowedDepths: ['light', 'personal'],
    pacing: '可以提出更具体的互动计划或感受，但仍需一次只推进一个动作。',
    requiredMoves: ['根据已发生的约会或聊天线索提出下一步', '保留明确的拒绝出口'],
    avoid: ['默认双方已经排他', '用约会次数推断承诺', '催促确认关系']
  },
  exclusive_relationship: {
    allowedDepths: ['light', 'personal', 'vulnerable'],
    pacing: '可以直接讨论感受、需要与边界，但使用具体事件而不是人格判断。',
    requiredMoves: ['使用第一人称表达自己的感受或需要', '把请求与命令区分开'],
    avoid: ['把稳定关系等同于无条件配合', '用关系身份施压', '替对方定义感受']
  },
  long_term_relationship: {
    allowedDepths: ['light', 'personal', 'vulnerable'],
    pacing: '关注可观察的重复互动与共同解决方案，不用一次对话解决所有问题。',
    requiredMoves: ['指出具体事件或模式', '提出一个双方都能讨论的小行动'],
    avoid: ['翻旧账罗列罪状', '人格标签', '绝对化总结整段关系']
  },
  after_conflict: {
    allowedDepths: ['pause'],
    pacing: '先降温、澄清和修复；在误会或边界未处理前暂停亲密推进。',
    requiredMoves: ['区分事实、影响、需要与请求', '允许对方暂时不谈或稍后再谈'],
    avoid: ['争论输赢', '逼迫立即回应或原谅', '直接邀约或推进亲密', '用玩笑掩盖冲突']
  }
} as const satisfies Record<RelationshipStage, StagePolicyDefinition>;

const GOAL_POLICIES = {
  start_conversation: {
    objective: '用与现有场景或共同线索相关的低负担开场，给对方一个容易回应的入口。',
    requiredMoves: ['引用一个具体场景或已有线索', '最多提出一个容易回答的问题'],
    avoid: ['只说“在吗”或空泛寒暄', '查户口式连问', '假装偶遇或编造共同经历']
  },
  keep_conversation_flowing: {
    objective: '延续已经出现的话题，而不是为了不断聊天而连续制造新问题。',
    requiredMoves: ['先回应对方最后提到的具体内容', '补充一点自己的信息', '最多提出一个问题'],
    avoid: ['同时开启多个新话题', '连续提问', '忽略对方刚刚表达的内容']
  },
  deepen_connection: {
    objective: '从事实或偏好自然过渡到体验与意义，一次只深入一层。',
    requiredMoves: ['从聊天中的既有线索过渡', '明确允许对方简短回答或不展开'],
    avoid: ['盘问敏感经历', '突然要求脆弱自我暴露', '把不回答解释为冷淡']
  },
  invite_to_meet: {
    objective: '提出清晰、具体、低压力的见面邀请，并让拒绝或改期保持容易。',
    requiredMoves: ['给出具体活动或场景', '提供大致时间范围', '包含明确的拒绝或改期出口'],
    avoid: ['制造紧迫感', '模糊试探让对方猜意图', '对拒绝追问原因']
  },
  express_interest: {
    objective: '只用第一人称表达自己的好感与继续了解的意愿，不替对方表态。',
    requiredMoves: ['陈述自己的真实感受', '不要求立即回应', '尊重双方现有节奏'],
    avoid: ['宣称对方也有好感', '索取关系承诺', '用付出换取回应']
  },
  repair_misunderstanding: {
    objective: '承认具体影响、澄清自己的本意，并提出一次低压力的沟通请求。',
    requiredMoves: ['承认对方可能受到的具体影响', '承担自己能承担的部分', '允许对方暂时不谈'],
    avoid: ['“但是”式道歉', '借道歉索取原谅', '争论对方是否应该难受']
  },
  set_boundary: {
    objective: '说明不可接受的具体行为、自己的需要，以及自己会采取的后续行动。',
    requiredMoves: ['描述具体行为而非评价人格', '使用第一人称说明需要', '说明自己可执行的后续行动'],
    avoid: ['威胁惩罚', '控制对方必须怎么做', '含糊暗示边界后要求对方猜测']
  }
} as const satisfies Record<Goal, GoalPolicyDefinition>;

const TONE_POLICIES = {
  natural: {
    sentenceLength: '1至2个日常口语短句',
    directness: '适中，先回应具体内容再自然进入下一句',
    emojiLimit: 1,
    requiredSignals: ['像用户本人会说的话', '用具体词替代抽象总结'],
    avoid: ['客服式共情', '报告或总结腔', '刻意煽情']
  },
  warm: {
    sentenceLength: '1至3个柔和但不冗长的句子',
    directness: '先回应对方的具体内容，再表达关心或邀请',
    emojiLimit: 1,
    requiredSignals: ['具体回应', '温和措辞', '不施压的结尾'],
    avoid: ['过度亲密称呼', '空泛安慰', '把温暖写成讨好或自我贬低']
  },
  playful: {
    sentenceLength: '1至2个轻快短句',
    directness: '用轻微幽默降低回答负担，但意图仍需清楚',
    emojiLimit: 1,
    requiredSignals: ['只围绕中性日常线索轻松表达', '玩笑后保留一个清楚的沟通动作'],
    avoid: ['拿拒绝、冲突、安全风险或弱点开玩笑', '讽刺', '阴阳怪气', '故意制造嫉妒']
  },
  direct: {
    sentenceLength: '1至2个短句',
    directness: '结论先行，只保留一个明确表达或请求',
    emojiLimit: 0,
    requiredSignals: ['明确说出自己的意图', '使用第一人称承担自己的选择'],
    avoid: ['过度铺垫', '暗示对方猜测', '命令或最后通牒']
  },
  calm: {
    sentenceLength: '1至2个中性短句',
    directness: '先陈述可观察事实或自己的需要，再提出低压力请求',
    emojiLimit: 0,
    requiredSignals: ['低情绪强度', '中性措辞', '允许暂停'],
    avoid: ['反问', '绝对化表达', '连续感叹号', '情绪升级']
  }
} as const satisfies Record<UserTone, TonePolicyDefinition>;

const STRATEGY_PRIORITY = [
  'authoritativeRisk_and_evidence',
  'stagePolicy',
  'goalPolicy',
  'tonePolicy'
] as const;

export function buildStrategyProfile(input: ConversationInput): StrategyProfile {
  return {
    priority: STRATEGY_PRIORITY,
    stagePolicy: {
      selected: input.relationshipStage,
      ...STAGE_POLICIES[input.relationshipStage]
    },
    goalPolicy: {
      selected: input.goal,
      ...GOAL_POLICIES[input.goal]
    },
    tonePolicy: {
      selected: input.userTone,
      ...TONE_POLICIES[input.userTone]
    }
  };
}
