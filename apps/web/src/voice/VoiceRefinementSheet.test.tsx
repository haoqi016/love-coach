import {
  ANALYSIS_MODEL_AUTO_ID,
  VoiceContextTokenSchema
} from '@alc/contracts';
import type { GuidanceRequest, VoiceCapabilities } from '@alc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  canInterruptVoicePhase,
  canShowVoiceForRisk,
  normalizeSelectedVoiceDraft,
  VoiceDraftPicker,
  VoiceRefinementSheet
} from './VoiceRefinementSheet';

const capabilities: Extract<VoiceCapabilities, { enabled: true }> = {
  enabled: true,
  modelLabel: 'Realtime mini（语音）',
  voiceLabel: '温暖自然声线',
  maxSessionSeconds: 300
};

const originalRequest: GuidanceRequest = {
  conversationText:
    '我：最近工作有点忙。\n对方：辛苦啦，周末可以休息一下。\n我：谢谢，我也想找时间放松。',
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'natural',
  analysisModelId: ANALYSIS_MODEL_AUTO_ID
};

describe('voice refinement presentation', () => {
  it('only allows low and caution results to expose the voice CTA', () => {
    expect(canShowVoiceForRisk('low')).toBe(true);
    expect(canShowVoiceForRisk('caution')).toBe(true);
    expect(canShowVoiceForRisk('high')).toBe(false);
    expect(canShowVoiceForRisk('crisis')).toBe(false);
  });

  it('only enables manual interruption after a response is actually active', () => {
    expect(canInterruptVoicePhase('thinking')).toBe(false);
    expect(canInterruptVoicePhase('speaking')).toBe(true);
    expect(canInterruptVoicePhase('safety_checking')).toBe(false);
  });

  it('requires one bounded draft before the microphone flow can open', () => {
    const drafts = [
      '周末要是你也有空，我们可以一起去喝杯咖啡。',
      '你上次提到的咖啡店听起来不错，哪天方便一起去看看吗？'
    ];
    const unselectedHtml = renderToStaticMarkup(
      <VoiceDraftPicker
        drafts={drafts}
        selectedIndex={null}
        onSelect={vi.fn()}
        onStart={vi.fn()}
      />
    );
    const selectedHtml = renderToStaticMarkup(
      <VoiceDraftPicker
        drafts={drafts}
        selectedIndex={1}
        onSelect={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(unselectedHtml).toContain('先选一条想继续打磨的回复');
    expect(unselectedHtml).toContain('选择草稿后开始');
    expect(unselectedHtml).toContain('disabled=""');
    expect(selectedHtml).toContain('用语音继续打磨');
    expect(selectedHtml).not.toContain('disabled=""');
    expect(normalizeSelectedVoiceDraft(['  一起\n喝咖啡吗？  '], 0)).toBe('一起 喝咖啡吗？');
    expect(normalizeSelectedVoiceDraft(['超'.repeat(601)], 0)).toBeNull();
  });

  it('renders 18+ consent, provider, privacy, and five-minute boundaries before access', () => {
    const html = renderToStaticMarkup(
      <VoiceRefinementSheet
        capabilities={capabilities}
        voiceContextToken={VoiceContextTokenSchema.parse('v'.repeat(40))}
        originalRequest={originalRequest}
        selectedDraft="周末要是你也有空，我们可以一起去喝杯咖啡。"
        onClose={vi.fn()}
        onRefined={vi.fn()}
      />
    );

    expect(html).toContain('最多 5 分钟');
    expect(html).toContain('OpenAI Realtime');
    expect(html).toContain('Realtime mini（语音）');
    expect(html).toContain('所选草稿、当前分析摘要和关系设置');
    expect(html).toContain('当前配置的分析模型服务');
    expect(html).toContain('自动模式可能按 Provider 链尝试');
    expect(html).toContain('音频和完整转写不由本应用保存');
    expect(html).toContain('本轮打磨的回复');
    expect(html).toContain('已完成且已通过安全检查的转写');
    expect(html).toContain('转写可能听错');
    expect(html).toContain('我已满 18 周岁');
    expect(html).toContain('通过检查的文字转写发送给当前分析模型服务');
    expect(html).toContain('允许麦克风并开始');
    expect(html).toContain('disabled=""');
  });
});
