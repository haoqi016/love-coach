import {
  ANALYSIS_MODEL_AUTO_ID,
  VoiceContextTokenSchema
} from '@alc/contracts';
import type { GuidanceRequest, VoiceCapabilities } from '@alc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RealtimeVoiceControls } from './useRealtimeVoice';

vi.mock('./useRealtimeVoice', () => ({
  useRealtimeVoice: vi.fn()
}));

import { useRealtimeVoice } from './useRealtimeVoice';
import { VoiceRefinementSheet } from './VoiceRefinementSheet';
import type { VoicePhase } from './voice-state';

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

function controlsForPhase(phase: VoicePhase): RealtimeVoiceControls {
  return {
    state: {
      phase,
      remainingSeconds: 247,
      muted: phase === 'transcribing' || phase === 'safety_checking',
      assistantSubtitle: phase === 'speaking' ? '你更希望这句话自然一点，还是明确一点？' : '',
      turns: [{ id: 'turn-1', transcript: '我想自然地邀请对方，但不想给压力。' }],
      errorMessage: '',
      safetyNotice: ''
    },
    start: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    toggleMute: vi.fn(),
    interrupt: vi.fn(),
    end: vi.fn(async () => undefined),
    close: vi.fn()
  };
}

function renderActiveSheet(phase: VoicePhase): string {
  vi.mocked(useRealtimeVoice).mockReturnValue(controlsForPhase(phase));
  return renderToStaticMarkup(
    <VoiceRefinementSheet
      capabilities={capabilities}
      voiceContextToken={VoiceContextTokenSchema.parse('v'.repeat(40))}
      originalRequest={originalRequest}
      selectedDraft="周末有空的话，要不要一起去喝杯咖啡？"
      onClose={vi.fn()}
      onRefined={vi.fn()}
    />
  );
}

describe('active voice refinement presentation', () => {
  beforeEach(() => {
    vi.mocked(useRealtimeVoice).mockReset();
  });

  it('shows the frozen draft, compact two-party subtitles, and turn count without a confirmation form', () => {
    const html = renderActiveSheet('speaking');

    expect(html).toContain('周末有空的话，要不要一起去喝杯咖啡？');
    expect(html).toContain('已交流 1 轮');
    expect(html).toContain('我想自然地邀请对方，但不想给压力。');
    expect(html).toContain('你更希望这句话自然一点，还是明确一点？');
    expect(html).toContain('结束并用本次转写生成建议');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('这准确表达了我的意思');
  });

  it.each(['transcribing', 'safety_checking'] as const)(
    'disables manual finalization while %s is still pending',
    (phase) => {
      const html = renderActiveSheet(phase);

      expect(html).toMatch(
        /<button type="button" disabled="">结束并用本次转写生成建议<\/button>/u
      );
      expect(html).toContain('安全检查完成后，我再回应。');
    }
  );

  it.each(['thinking', 'speaking'] as const)(
    'keeps finalization available while the coach is %s',
    (phase) => {
      const html = renderActiveSheet(phase);
      const button = html.match(
        /<button type="button"(?: disabled="")?>结束并用本次转写生成建议<\/button>/u
      )?.[0];

      expect(button).toBeDefined();
      expect(button).not.toContain('disabled');
    }
  );
});
