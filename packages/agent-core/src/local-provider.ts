import type {
  ConversationInput,
  EvidenceBasis,
  Goal,
  GuidanceOutput,
  MessageOption,
  Pacing,
  RecommendedDepth,
  Reciprocity,
  RiskAssessment,
  UserTone
} from '@alc/contracts';

import {
  throwIfGuidanceAborted,
  type ModelProvider,
  type ModelProviderContext
} from './model-provider.js';
import { buildStrategyProfile, type StrategyProfile } from './strategy-profile.js';

type Speaker = 'self' | 'other' | 'unknown';

interface ParsedMessage {
  readonly speaker: Speaker;
  readonly text: string;
}

interface TopicRule {
  readonly name: string;
  readonly pattern: RegExp;
}

const TOPIC_RULES: readonly TopicRule[] = [
  { name: '工作与学习', pattern: /工作|上班|项目|同事|学习|考试|课程|论文/u },
  { name: '音乐', pattern: /音乐|歌|歌手|演唱会|乐队/u },
  { name: '电影与剧集', pattern: /电影|电视剧|剧集|综艺|影院/u },
  { name: '旅行', pattern: /旅行|旅游|出差|城市|景点|酒店/u },
  { name: '美食', pattern: /吃饭|美食|餐厅|咖啡|火锅|做饭|甜品/u },
  { name: '运动', pattern: /运动|健身|跑步|游泳|爬山|球/u },
  { name: '宠物', pattern: /猫|狗|宠物/u },
  { name: '周末与休息', pattern: /周末|休息|放假|下班/u }
];

const SPEAKER_PATTERN = /^(我|自己|本人|对方|TA|ta|他|她)\s*[：:]\s*(.+)$/u;

function parseConversation(text: string): ParsedMessage[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = SPEAKER_PATTERN.exec(line);
      if (match === null) {
        return { speaker: 'unknown', text: line };
      }

      const marker = match[1] ?? '';
      const messageText = match[2] ?? line;
      const speaker: Speaker = ['我', '自己', '本人'].includes(marker) ? 'self' : 'other';
      return { speaker, text: messageText };
    });
}

function topicsFor(messages: readonly ParsedMessage[], speaker: Speaker): Set<string> {
  const text = messages
    .filter((message) => message.speaker === speaker)
    .map((message) => message.text)
    .join('\n');
  return new Set(
    TOPIC_RULES.filter((topic) => topic.pattern.test(text)).map((topic) => topic.name)
  );
}

function findMutualTopics(messages: readonly ParsedMessage[]): string[] {
  const selfTopics = topicsFor(messages, 'self');
  const otherTopics = topicsFor(messages, 'other');
  return [...selfTopics].filter((topic) => otherTopics.has(topic)).slice(0, 4);
}

function quoteEvidence(message: ParsedMessage): EvidenceBasis {
  return { kind: 'quote', quote: message.text.slice(0, 120) };
}

function representativeEvidence(messages: readonly ParsedMessage[]): EvidenceBasis[] {
  const selfMessage = messages.find((message) => message.speaker === 'self');
  const otherMessage = messages.find((message) => message.speaker === 'other');
  const representatives = [selfMessage, otherMessage].filter(
    (message): message is ParsedMessage => message !== undefined
  );

  return representatives.length > 0
    ? representatives.map(quoteEvidence)
    : messages[0] !== undefined
      ? [quoteEvidence(messages[0])]
      : [{ kind: 'advice' }];
}

function mutualEvidence(
  messages: readonly ParsedMessage[],
  topic: string
): EvidenceBasis[] {
  const topicRule = TOPIC_RULES.find((rule) => rule.name === topic);
  if (topicRule === undefined) {
    return topicEvidence(messages, topic);
  }

  const selfMessage = messages.find(
    (message) => message.speaker === 'self' && topicRule.pattern.test(message.text)
  );
  const otherMessage = messages.find(
    (message) => message.speaker === 'other' && topicRule.pattern.test(message.text)
  );
  const matchingMessages = [selfMessage, otherMessage].filter(
    (message): message is ParsedMessage => message !== undefined
  );
  return matchingMessages.length > 0
    ? matchingMessages.map(quoteEvidence)
    : topicEvidence(messages, topic);
}

function topicEvidence(
  messages: readonly ParsedMessage[],
  topic: string
): EvidenceBasis[] {
  const topicRule = TOPIC_RULES.find((rule) => rule.name === topic);
  const matchingMessage =
    topicRule === undefined
      ? undefined
      : messages.find(
          (message) =>
            message.speaker === 'other' && topicRule.pattern.test(message.text)
        ) ?? messages.find((message) => topicRule.pattern.test(message.text));
  const fallbackMessage =
    [...messages].reverse().find((message) => message.speaker === 'other') ??
    [...messages].reverse().find((message) => message.speaker !== 'unknown');

  return matchingMessage !== undefined
    ? [quoteEvidence(matchingMessage)]
    : fallbackMessage !== undefined
      ? [quoteEvidence(fallbackMessage)]
      : [{ kind: 'advice' }];
}

function interactionPattern(messages: readonly ParsedMessage[]): {
  reciprocity: Reciprocity;
  pacing: Pacing;
  observation: string;
  evidence: EvidenceBasis[];
} {
  const known = messages.filter((message) => message.speaker !== 'unknown');
  const selfCount = known.filter((message) => message.speaker === 'self').length;
  const otherCount = known.filter((message) => message.speaker === 'other').length;

  if (selfCount === 0 || otherCount === 0 || known.length < 4) {
    return {
      reciprocity: 'limited_data',
      pacing: 'limited_data',
      observation: '目前缺少双方连续对话，无法可靠判断互动是否平衡或聊天节奏。',
      evidence: representativeEvidence(messages)
    };
  }

  const ratio = selfCount / otherCount;
  const reciprocity: Reciprocity = ratio > 1.6 ? 'user_leads' : ratio < 0.625 ? 'other_leads' : 'balanced';
  let alternations = 0;
  for (let index = 1; index < known.length; index += 1) {
    if (known[index]?.speaker !== known[index - 1]?.speaker) {
      alternations += 1;
    }
  }
  const alternationRate = alternations / (known.length - 1);
  const pacing: Pacing = alternationRate >= 0.7 ? 'steady' : 'uneven';
  const balanceText =
    reciprocity === 'balanced'
      ? '双方都有持续回应'
      : reciprocity === 'user_leads'
        ? '目前主要由你发起和延续话题'
        : '目前更多由对方发起和延续话题';

  return {
    reciprocity,
    pacing,
    observation: `${balanceText}；从轮次看，节奏${pacing === 'steady' ? '较连贯' : '有些不均匀'}。粘贴文本不含时间信息，因此不能推断回复速度。`,
    evidence: representativeEvidence(known)
  };
}

function findOpenLoops(messages: readonly ParsedMessage[]): Array<{
  readonly text: string;
  readonly evidence: EvidenceBasis[];
}> {
  const lastOther = [...messages].reverse().find((message) => message.speaker === 'other');
  const unansweredSelfQuestion = [...messages]
    .reverse()
    .find((message) => message.speaker === 'self' && /[？?]/u.test(message.text));
  const loops: Array<{ text: string; evidence: EvidenceBasis[] }> = [];

  if (lastOther !== undefined) {
    const snippet = lastOther.text.length > 52 ? `${lastOther.text.slice(0, 52)}…` : lastOther.text;
    loops.push({
      text: `对方最近提到“${snippet}”，可以先回应这条线索，再开启新话题。`,
      evidence: [quoteEvidence(lastOther)]
    });
  }

  if (unansweredSelfQuestion !== undefined && messages.at(-1)?.speaker === 'self') {
    loops.push({
      text: '你最后的问题尚未看到回应，继续追加消息前可以先留出空间。',
      evidence: [quoteEvidence(unansweredSelfQuestion)]
    });
  }

  return loops.slice(0, 3);
}

function recommendDepth(
  input: ConversationInput,
  reciprocity: Reciprocity,
  risk: RiskAssessment
): RecommendedDepth {
  if (risk.level === 'high' || risk.level === 'crisis') {
    return 'pause';
  }
  const allowedDepths = buildStrategyProfile(input).stagePolicy.allowedDepths;
  if (allowedDepths.includes('pause')) {
    return 'pause';
  }
  if (
    reciprocity === 'limited_data' ||
    reciprocity === 'user_leads' ||
    allowedDepths.length === 1
  ) {
    return 'light';
  }
  if (
    input.goal === 'deepen_connection' &&
    reciprocity === 'balanced' &&
    allowedDepths.includes('vulnerable')
  ) {
    return 'vulnerable';
  }
  return allowedDepths.includes('personal') ? 'personal' : 'light';
}

const AFTER_CONFLICT_DRAFTS = {
  natural: () =>
    '刚才那段对话可能都需要一点缓冲。我先停一下，等我们都方便时再把具体误会说清楚。',
  warm: () =>
    '我在意你的感受，也不想让刚才的不舒服继续。我先留一点空间，等你愿意时我们再把具体误会说清楚。',
  playful: () =>
    '这次我先不拿玩笑带过去。等我们都舒服一些，我想认真把刚才的误会说清楚。',
  direct: () =>
    '我先暂停这段对话。等我们都冷静些，我想把刚才的具体误会说清楚。',
  calm: () =>
    '先暂停沟通，避免继续升级。双方都方便时，再讨论具体事实和需要。'
} as const satisfies Record<UserTone, () => string>;

const GOAL_DRAFTS = {
  start_conversation: {
    natural: (topic) => `刚想到我们之前聊过的${topic}。你最近有没有什么新发现？`,
    warm: (topic) =>
      `刚想到你之前提过的${topic}，感觉挺有意思的。你最近有新发现吗？有空再聊就好。`,
    playful: (topic) => `${topic}这个话题又突然冒出来了 😄 你最近有没有挖到什么新东西？`,
    direct: (topic) => `想接着聊聊${topic}。你最近有什么新发现？`,
    calm: (topic) => `想到我们之前聊过的${topic}。你有空时，可以说说最近有没有新发现。`
  },
  keep_conversation_flowing: {
    natural: (topic) =>
      `你刚才提到${topic}，我也想到一点自己的经历。对你来说，里面最有意思的是哪部分？`,
    warm: (topic) =>
      `你刚才说到${topic}，我挺想继续听的。我也有一点类似经历，你愿意的话可以说说最有意思的部分。`,
    playful: (topic) =>
      `你一提${topic}，这个话题就有点停不下来了 😄 最有意思的是哪一段？`,
    direct: (topic) => `我想继续聊${topic}。你最想展开哪一部分？`,
    calm: (topic) => `你刚才提到了${topic}。可以先说说你最想展开的部分，不急着回复。`
  },
  deepen_connection: {
    natural: (topic) =>
      `听你说到${topic}，我有点好奇这件事为什么对你重要。愿意的话可以多讲一点。`,
    warm: (topic) =>
      `听你说到${topic}，我有点好奇它对你的意义。如果你愿意，我想多听一点。`,
    playful: (topic) =>
      `${topic}听起来还有不少故事 😄 如果你愿意，最想分享的是哪部分？`,
    direct: (topic) => `我想更了解${topic}对你的意义。你愿意说说吗？`,
    calm: (topic) => `如果你愿意，可以说说${topic}对你意味着什么；不想展开也没关系。`
  },
  invite_to_meet: {
    natural: (topic) =>
      `我们都聊到${topic}了。这个周末要不要一起找个轻松的地方坐坐？不方便也没关系。`,
    warm: (topic) =>
      `和你聊${topic}挺开心的。这个周末如果你方便，要不要一起找个轻松的地方坐坐？时间不合适也没关系。`,
    playful: (topic) =>
      `${topic}都聊到这一步了，要不要把它从聊天框搬到线下 😄 这个周末一起坐坐？不方便也完全没关系。`,
    direct: (topic) =>
      `这个周末想约你一起聊聊${topic}。你方便吗？不合适可以直接说。`,
    calm: (topic) =>
      `如果你愿意，这个周末可以一起找个安静的地方聊聊${topic}；不方便也没关系。`
  },
  express_interest: {
    natural: () =>
      '最近和你聊天我觉得挺舒服的，也想继续多了解你一些。你不用急着回应，我们按舒服的节奏来。',
    warm: () =>
      '最近和你聊天让我觉得很开心，我也很珍惜这种感觉。想继续多了解你一些，不用急着回应。',
    playful: () =>
      '认真说一句：最近和你聊天还挺让人期待的 😄 我想继续多了解你一些，不急着给答案。',
    direct: () =>
      '我对你有好感，也想继续了解你。你不用现在回应，我们按彼此舒服的节奏来。',
    calm: () =>
      '我想坦诚说明，我对你有好感，也愿意继续了解你。你可以按自己的节奏回应。'
  },
  repair_misunderstanding: {
    natural: () =>
      '我担心刚才的表达让你不舒服，这部分是我没处理好。你愿意的话，我们之后把具体误会说清楚；现在不想谈也可以。',
    warm: () =>
      '如果刚才的话让你不舒服，我很抱歉，也在意你的感受。等你愿意时，我想听听你的感受并把误会说清楚。',
    playful: () =>
      '这次我不想用玩笑带过去：刚才的表达可能让你不舒服。等你愿意时，我想认真把误会说清楚。',
    direct: () =>
      '刚才的表达不合适，这部分我负责。你愿意时，我想把误会说清楚；暂时不谈也可以。',
    calm: () =>
      '刚才的表达可能造成了不适。我先暂停，等你愿意时再澄清具体事实和需要。'
  },
  set_boundary: {
    natural: () =>
      '我不希望我们继续用这种方式聊这个话题。如果再次发生，我会先结束对话，等彼此都能尊重边界时再沟通。',
    warm: () =>
      '我重视我们的沟通，也需要这个边界被尊重。若再次出现同样情况，我会先暂停对话，之后再看是否适合继续。',
    playful: () =>
      '这件事我还是要认真说：这个边界不能用玩笑带过。如果再次发生，我会先结束对话。',
    direct: () =>
      '我不能接受这种沟通方式。如果再次发生，我会结束这次对话。',
    calm: () =>
      '我不接受这种沟通方式。若再次发生，我会暂停联系，并在边界被尊重后再决定是否继续沟通。'
  }
} as const satisfies Record<Goal, Record<UserTone, (topic: string) => string>>;

function conflictStageOverridesGoal(input: ConversationInput): boolean {
  return (
    input.relationshipStage === 'after_conflict' &&
    !['repair_misunderstanding', 'set_boundary'].includes(input.goal)
  );
}

function messageTextFor(
  input: ConversationInput,
  style: UserTone,
  topic: string
): string {
  return conflictStageOverridesGoal(input)
    ? AFTER_CONFLICT_DRAFTS[style]()
    : GOAL_DRAFTS[input.goal][style](topic);
}

function watchForGoal(goal: Goal): string {
  switch (goal) {
    case 'invite_to_meet':
      return '如果对方拒绝、回避或没有回应，不要追问原因，也不要立刻更换时间继续邀请。';
    case 'express_interest':
      return '不要把礼貌回应解释为同样的好感，也不要追问对方立即表态。';
    case 'repair_misunderstanding':
      return '如果对方暂时不想谈，先停止解释和辩解，尊重暂停。';
    case 'set_boundary':
      return '边界依靠你自己的后续行动执行，不要用威胁、惩罚或反复争论强化。';
    default:
      return '观察对方是否主动展开；如果只给简短回应或没有回应，不要连续追问。';
  }
}

function buildMessageOptions(
  input: ConversationInput,
  topic: string,
  limitedData: boolean,
  evidence: readonly EvidenceBasis[],
  strategy: StrategyProfile
): MessageOption[] {
  const styles: UserTone[] = [input.userTone, 'natural', 'calm'];
  const uniqueStyles = [...new Set(styles)].slice(0, 3);
  return uniqueStyles.map((style) => ({
    style,
    text: messageTextFor(input, style, topic),
    why: limitedData
      ? `目前信息有限。${strategy.stagePolicy.pacing}${strategy.goalPolicy.objective}`
      : `承接已有的“${topic}”线索。${strategy.stagePolicy.pacing}${strategy.goalPolicy.objective}`,
    watchFor: watchForGoal(input.goal),
    evidence: limitedData ? [{ kind: 'advice' }] : [...evidence]
  }));
}

function topicBridgeFor(input: ConversationInput, topic: string): {
  readonly from: string;
  readonly to: string;
  readonly prompt: string;
} {
  if (conflictStageOverridesGoal(input)) {
    return {
      from: topic,
      to: '具体影响与修复意愿',
      prompt: '先暂停推进，只描述刚才发生的具体事实和影响，再提出一次可拒绝的沟通请求。'
    };
  }

  switch (input.goal) {
    case 'start_conversation':
      return {
        from: topic,
        to: '容易回应的自然开场',
        prompt: `引用${topic}中的一个具体细节，只问一个对方可以简短回答的问题。`
      };
    case 'keep_conversation_flowing':
      return {
        from: topic,
        to: '延续当前话题',
        prompt: `先回应${topic}里的具体内容，补充一点自己的信息，再问一个问题。`
      };
    case 'deepen_connection':
      return {
        from: topic,
        to: '对方愿意展开的个人体验',
        prompt: `从${topic}过渡到体验或意义，一次只深入一层，并允许对方不展开。`
      };
    case 'invite_to_meet':
      return {
        from: topic,
        to: '低压力的线下邀请',
        prompt: `把${topic}转成一个包含活动、大致时间和拒绝出口的具体邀请。`
      };
    case 'express_interest':
      return {
        from: topic,
        to: '第一人称的好感表达',
        prompt: `承接${topic}，只表达自己的感受和继续了解的意愿，不替对方表态。`
      };
    case 'repair_misunderstanding':
      return {
        from: topic,
        to: '具体影响与修复请求',
        prompt: '承认具体影响，说明自己能承担的部分，再提出一次允许暂停的沟通请求。'
      };
    case 'set_boundary':
      return {
        from: topic,
        to: '清楚、可执行的边界',
        prompt: '描述具体行为和自己的需要，再说明自己会采取的后续行动。'
      };
  }
}

const NEXT_STEP_BY_GOAL = {
  start_conversation: '选一个已有的具体线索，用一句开场加一个容易回答的问题；发送后等待回应。',
  keep_conversation_flowing: '先回应对方最后一条具体内容，再补充一点自己的信息，最多问一个问题后等待。',
  deepen_connection: '从已有话题只深入一层，并明确对方可以不展开；如果回应简短，就回到轻松话题。',
  invite_to_meet: '提出一个包含活动和大致时间的邀请，并写明不方便或想改期也没关系。',
  express_interest: '只表达自己的好感和继续了解的意愿，不要求对方立即表态。',
  repair_misunderstanding: '先承认具体影响并暂停争辩，提出一次澄清请求；对方暂时不谈时尊重暂停。',
  set_boundary: '明确具体边界和自己会采取的行动；发送后不要继续争辩或用威胁强化。'
} as const satisfies Record<Goal, string>;

function nextStepFor(
  input: ConversationInput,
  limitedData: boolean,
  strategy: StrategyProfile
): string {
  if (conflictStageOverridesGoal(input)) {
    return '先暂停关系推进和继续发送，等双方都方便时再处理具体误会；对方不愿继续时尊重停止。';
  }
  const nextStep = NEXT_STEP_BY_GOAL[input.goal];
  const stagePacing = `考虑到你们当前的关系阶段，${strategy.stagePolicy.pacing}`;
  return limitedData
    ? `目前信息有限。${stagePacing}${nextStep}`
    : `${stagePacing}${nextStep}`;
}

function buildSafeOutput(risk: RiskAssessment): GuidanceOutput {
  const crisis = risk.level === 'crisis';
  return {
    summary: crisis
      ? '当前最重要的不是推进关系，而是先处理可能存在的立即安全风险。'
      : '这项请求涉及不尊重同意或人身边界的做法，因此不能提供推进策略。',
    summaryEvidence: [{ kind: 'advice' }],
    mutualTopics: [],
    mutualTopicEvidence: [],
    openLoops: [],
    openLoopEvidence: [],
    interactionPattern: {
      reciprocity: 'limited_data',
      pacing: 'limited_data',
      observation: '在安全风险处理前，不适合继续解读聊天节奏或设计关系推进策略。',
      evidence: [{ kind: 'advice' }]
    },
    uncertainties: ['未知：仅凭文字无法确认现场风险程度，也无法确认对方的真实想法或意愿。'],
    recommendedDepth: 'pause',
    topicBridges: [],
    messageOptions: [
      {
        style: 'calm',
        text: crisis
          ? '我现在先暂停这段对话，并联系身边可信任的人获得帮助。'
          : '我会尊重你的选择和边界，先不继续联系。',
        why: crisis ? '先降低即时风险并获得真人支持。' : '明确停止施压，尊重对方自由拒绝和退出的权利。',
        watchFor: crisis
          ? '如果危险正在发生，不要独自处理，请立即联系当地紧急服务。'
          : '不要换账号、借他人账号或线下堵截对方。',
        evidence: [{ kind: 'advice' }]
      }
    ],
    risk,
    nextStep: crisis
      ? '离开可能升级危险的环境，联系可信任的人陪伴；若存在立即危险，请联系当地紧急服务。'
      : '停止当前推进计划，删除任何跟踪、施压或绕过拒绝的步骤，只在对方自愿重新联系时回应。',
    nextStepEvidence: [{ kind: 'advice' }]
  };
}

export class LocalModelProvider implements ModelProvider {
  public readonly name = 'deterministic-local';

  public async generateGuidance(
    input: ConversationInput,
    context: ModelProviderContext
  ): Promise<GuidanceOutput> {
    throwIfGuidanceAborted(context.signal);
    if (context.safety.level === 'high' || context.safety.level === 'crisis') {
      return buildSafeOutput(context.safety);
    }

    const messages = parseConversation(input.conversationText);
    const pattern = interactionPattern(messages);
    const mutualTopics = findMutualTopics(messages);
    const openLoops = findOpenLoops(messages);
    const limitedData = pattern.reciprocity === 'limited_data';
    const topic = mutualTopics[0] ?? '最近聊到的日常';
    const evidence = topicEvidence(messages, topic);
    const strategy = buildStrategyProfile(input);
    const recommendedDepth = recommendDepth(input, pattern.reciprocity, context.safety);
    const topicBridge = topicBridgeFor(input, topic);

    return {
      summary: limitedData
        ? '目前提供的内容还不足以判断双方互动是否稳定。建议先补充一小段双方连续对话，再决定是否加深话题。'
        : `这段对话里${pattern.reciprocity === 'balanced' ? '双方都有回应' : '主动程度暂时不完全对称'}。下一步更适合承接已有话题，并给对方自由选择回应深度。`,
      summaryEvidence: pattern.evidence,
      mutualTopics,
      mutualTopicEvidence: mutualTopics.map((mutualTopic) =>
        mutualEvidence(messages, mutualTopic)
      ),
      openLoops: openLoops.map((loop) => loop.text),
      openLoopEvidence: openLoops.map((loop) => loop.evidence),
      interactionPattern: pattern,
      uncertainties: [
        '未知：文字记录无法呈现语气、时间间隔和线下背景，因此不能据此判断对方的真实心意。',
        ...(limitedData ? ['待确认：双方连续对话不足，任何互动趋势都只能作为待验证线索。'] : [])
      ],
      recommendedDepth,
      topicBridges: limitedData
        ? []
        : [
            {
              ...topicBridge,
              evidence
            }
          ],
      messageOptions: buildMessageOptions(
        input,
        topic,
        limitedData,
        evidence,
        strategy
      ),
      risk: context.safety,
      nextStep: nextStepFor(input, limitedData, strategy),
      nextStepEvidence: [{ kind: 'advice' }]
    };
  }
}

export function createSafetyGuidance(
  risk: RiskAssessment
): GuidanceOutput {
  return buildSafeOutput(risk);
}
