import type { ConversationInput, GuidanceOutput } from '@alc/contracts';

export const relationshipStages: ReadonlyArray<{
  value: ConversationInput['relationshipStage'];
  label: string;
  note: string;
}> = [
  { value: 'just_met', label: '刚刚认识', note: '还在寻找自然的开场' },
  { value: 'getting_to_know', label: '正在了解', note: '已经聊过几次，想更熟悉彼此' },
  { value: 'dating', label: '约会阶段', note: '见过面，关系仍在发展' },
  { value: 'exclusive_relationship', label: '确认关系', note: '正在稳定交往' },
  { value: 'long_term_relationship', label: '长期相处', note: '相处了一段时间' },
  { value: 'after_conflict', label: '发生分歧', note: '想修复误解或重新沟通' }
];

export const goals: ReadonlyArray<{
  value: ConversationInput['goal'];
  label: string;
}> = [
  { value: 'start_conversation', label: '自然开场' },
  { value: 'keep_conversation_flowing', label: '让话题继续' },
  { value: 'deepen_connection', label: '多了解彼此' },
  { value: 'invite_to_meet', label: '轻松邀约' },
  { value: 'express_interest', label: '表达好感' },
  { value: 'repair_misunderstanding', label: '修复误会' },
  { value: 'set_boundary', label: '说清边界' }
];

export const tones: ReadonlyArray<{
  value: ConversationInput['userTone'];
  label: string;
}> = [
  { value: 'natural', label: '自然' },
  { value: 'warm', label: '温暖' },
  { value: 'playful', label: '轻松俏皮' },
  { value: 'direct', label: '直接坦诚' },
  { value: 'calm', label: '平静克制' }
];

export const depthLabels: Record<GuidanceOutput['recommendedDepth'], string> = {
  light: '保持轻松',
  personal: '稍微深入',
  vulnerable: '真诚表达',
  pause: '先留一点空间'
};

export const reciprocityLabels: Record<
  GuidanceOutput['interactionPattern']['reciprocity'],
  string
> = {
  balanced: '双方都在投入',
  user_leads: '你主动得更多',
  other_leads: '对方主动得更多',
  limited_data: '信息还不够'
};

export const pacingLabels: Record<GuidanceOutput['interactionPattern']['pacing'], string> = {
  steady: '节奏稳定',
  fast: '节奏较快',
  slow: '节奏偏慢',
  uneven: '节奏有起伏',
  limited_data: '信息还不够'
};

export const sampleConversation = `我：你上次说的那家旧书店我今天路过了，真的有一只橘猫守门 😂
对方：哈哈你居然还记得！它是不是又在收银台睡觉
我：对，而且完全不理人。你经常去那边吗？
对方：以前周末会去，最近工作忙就很少了
我：听起来最近挺辛苦的
对方：还好啦，这周项目终于快结束了
我：那很值得庆祝一下
对方：是啊，终于可以喘口气了`;

export const sampleContext = '我们认识两周，是朋友聚会认识的。想自然地约对方周末一起去旧书店。';
