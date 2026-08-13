import { describe, expect, it } from 'vitest';

import {
  createInitialVoiceState,
  formatRemainingTime,
  voiceReducer,
  voicePhaseLabel
} from './voice-state';

describe('voice refinement state', () => {
  it('records a completed, safety-approved transcript once', () => {
    const initial = createInitialVoiceState(300);
    const completed = voiceReducer(initial, {
      type: 'turn_completed',
      id: 'turn-1',
      transcript: '  我其实担心自己说得太急。 '
    });
    const duplicate = voiceReducer(completed, {
      type: 'turn_completed',
      id: 'turn-1',
      transcript: '重复事件不应覆盖已完成转写。'
    });

    expect(duplicate.turns).toEqual([
      {
        id: 'turn-1',
        transcript: '我其实担心自己说得太急。'
      }
    ]);
  });

  it('preserves completed turns when the five-minute timer ends', () => {
    const withTurn = voiceReducer(createInitialVoiceState(300), {
      type: 'turn_completed',
      id: 'turn-1',
      transcript: '我希望先把语气放轻一点。'
    });
    const atZero = voiceReducer(withTurn, { type: 'tick', remainingSeconds: 0 });
    const ended = voiceReducer(atZero, { type: 'phase', phase: 'ended' });

    expect(ended.phase).toBe('ended');
    expect(ended.remainingSeconds).toBe(0);
    expect(ended.turns).toEqual(withTurn.turns);
  });

  it('preserves elapsed time and completed turns when the connection fails', () => {
    const withTurn = voiceReducer(createInitialVoiceState(300), {
      type: 'turn_completed',
      id: 'turn-1',
      transcript: '我希望先把语气放轻一点。'
    });
    const elapsed = voiceReducer(withTurn, { type: 'tick', remainingSeconds: 184 });
    const failed = voiceReducer(elapsed, {
      type: 'error',
      message: '实时语音连接中断。'
    });

    expect(failed.phase).toBe('error');
    expect(failed.remainingSeconds).toBe(184);
    expect(failed.turns).toEqual(withTurn.turns);
  });

  it('clears transcript text in deterministic safety-stop cleanup', () => {
    const withTurn = voiceReducer(createInitialVoiceState(300), {
      type: 'turn_completed',
      id: 'turn-1',
      transcript: '普通补充'
    });
    const cleared = voiceReducer(withTurn, {
      type: 'reset',
      maxSessionSeconds: 300
    });
    const stopped = voiceReducer(cleared, {
      type: 'safety_stop',
      notice: '请先联系可信任的人。'
    });

    expect(stopped.turns).toEqual([]);
    expect(stopped.phase).toBe('safety_stop');
    expect(stopped.safetyNotice).toContain('可信任的人');
  });

  it('formats the visible session countdown', () => {
    expect(formatRemainingTime(300)).toBe('05:00');
    expect(formatRemainingTime(7)).toBe('00:07');
  });

  it('shows a clear wait state while transcription and safety checks keep the mic muted', () => {
    expect(voicePhaseLabel('transcribing')).toBe('正在处理上一句话，请稍等');
    expect(voicePhaseLabel('safety_checking')).toBe('正在处理上一句话，请稍等');
  });
});
