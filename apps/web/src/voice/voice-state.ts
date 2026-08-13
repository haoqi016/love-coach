export type VoicePhase =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'safety_checking'
  | 'thinking'
  | 'speaking'
  | 'refining'
  | 'completed'
  | 'safety_stop'
  | 'ended'
  | 'error';

export interface VoiceTranscriptTurn {
  id: string;
  transcript: string;
}

export interface VoiceState {
  phase: VoicePhase;
  remainingSeconds: number;
  muted: boolean;
  assistantSubtitle: string;
  turns: readonly VoiceTranscriptTurn[];
  errorMessage: string;
  safetyNotice: string;
}

export type VoiceAction =
  | { type: 'phase'; phase: VoicePhase }
  | { type: 'tick'; remainingSeconds: number }
  | { type: 'muted'; muted: boolean }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_reset' }
  | { type: 'turn_completed'; id: string; transcript: string }
  | { type: 'safety_stop'; notice: string }
  | { type: 'error'; message: string }
  | { type: 'reset'; maxSessionSeconds: number };

export function createInitialVoiceState(maxSessionSeconds: number): VoiceState {
  return {
    phase: 'idle',
    remainingSeconds: Math.max(0, Math.floor(maxSessionSeconds)),
    muted: false,
    assistantSubtitle: '',
    turns: [],
    errorMessage: '',
    safetyNotice: ''
  };
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case 'phase':
      return { ...state, phase: action.phase, errorMessage: '' };
    case 'tick':
      return { ...state, remainingSeconds: Math.max(0, action.remainingSeconds) };
    case 'muted':
      return { ...state, muted: action.muted };
    case 'assistant_delta':
      return { ...state, assistantSubtitle: `${state.assistantSubtitle}${action.delta}` };
    case 'assistant_reset':
      return { ...state, assistantSubtitle: '' };
    case 'turn_completed': {
      const transcript = action.transcript.trim();
      if (!transcript) return state;
      const existing = state.turns.find((turn) => turn.id === action.id);
      if (existing) return state;
      return {
        ...state,
        turns: [
          ...state.turns,
          {
            id: action.id,
            transcript
          }
        ]
      };
    }
    case 'safety_stop':
      return {
        ...state,
        phase: 'safety_stop',
        safetyNotice: action.notice,
        assistantSubtitle: '',
        muted: true
      };
    case 'error':
      return {
        ...state,
        phase: 'error',
        errorMessage: action.message,
        assistantSubtitle: '',
        muted: true
      };
    case 'reset':
      return createInitialVoiceState(action.maxSessionSeconds);
  }
}

export function formatRemainingTime(seconds: number): string {
  const bounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(bounded / 60);
  const remainder = bounded % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function voicePhaseLabel(phase: VoicePhase): string {
  const labels: Record<VoicePhase, string> = {
    idle: '准备好后再开始',
    requesting_permission: '正在请求麦克风权限',
    connecting: '正在接通教练',
    listening: '正在听你说',
    transcribing: '正在处理上一句话，请稍等',
    safety_checking: '正在处理上一句话，请稍等',
    thinking: '教练正在想一想',
    speaking: '教练正在回应',
    refining: '正在更新建议',
    completed: '建议已经更新',
    safety_stop: '这轮先停在安全这里',
    ended: '本次对话已结束',
    error: '连接暂时中断'
  };
  return labels[phase];
}
