import type {
  GuidanceRequest,
  RiskLevel,
  VoiceCapabilities,
  VoiceContextToken
} from '@alc/contracts';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { fetchVoiceCapabilities } from './voice-api';
import type { VoiceRefinementResponse } from './voice-api';
import type { VoiceRealtimeControllerFactory } from './realtime-controller';
import type { VoiceApiClient, UseRealtimeVoiceOptions } from './useRealtimeVoice';
import { useRealtimeVoice } from './useRealtimeVoice';
import { formatRemainingTime, voicePhaseLabel } from './voice-state';
import type { VoicePhase } from './voice-state';
import './voice.css';

type EnabledVoiceCapabilities = Extract<VoiceCapabilities, { enabled: true }>;

const MAX_SELECTED_DRAFT_LENGTH = 600;

function isActivePhase(phase: VoicePhase): boolean {
  return [
    'requesting_permission',
    'connecting',
    'listening',
    'transcribing',
    'safety_checking',
    'thinking',
    'speaking'
  ].includes(phase);
}

export function canShowVoiceForRisk(risk: RiskLevel): boolean {
  return risk === 'low' || risk === 'caution';
}

export function canInterruptVoicePhase(phase: VoicePhase): boolean {
  return phase === 'speaking';
}

export function normalizeSelectedVoiceDraft(
  drafts: readonly string[],
  selectedIndex: number | null
): string | null {
  if (selectedIndex === null) return null;
  const draft = drafts[selectedIndex]?.replace(/\s+/gu, ' ').trim();
  if (!draft || draft.length > MAX_SELECTED_DRAFT_LENGTH) return null;
  return draft;
}

export interface VoiceDraftPickerProps {
  drafts: readonly string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onStart: () => void;
}

export function VoiceDraftPicker({
  drafts,
  selectedIndex,
  onSelect,
  onStart
}: VoiceDraftPickerProps): ReactNode {
  const selectedDraft = normalizeSelectedVoiceDraft(drafts, selectedIndex);
  const selectedRawDraft = selectedIndex === null ? '' : drafts[selectedIndex] ?? '';
  const selectedDraftTooLong = selectedRawDraft.trim().length > MAX_SELECTED_DRAFT_LENGTH;

  return (
    <div className="voice-entry__action">
      <fieldset className="voice-draft-picker">
        <legend>先选一条想继续打磨的回复</legend>
        <div className="voice-draft-picker__options">
          {drafts.map((draft, index) => (
            <label
              className={selectedIndex === index ? 'voice-draft-choice is-selected' : 'voice-draft-choice'}
              key={`${index}-${draft}`}
            >
              <input
                type="radio"
                name="voice-selected-draft"
                checked={selectedIndex === index}
                onChange={() => onSelect(index)}
              />
              <span>
                <strong>草稿 {String(index + 1).padStart(2, '0')}</strong>
                <small>{draft}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {selectedDraftTooLong ? (
        <p className="voice-entry__warning" role="alert">
          这条草稿超过 600 字，请先在上方缩短后再开始。
        </p>
      ) : null}
      <button
        className="voice-entry__button"
        type="button"
        disabled={!selectedDraft}
        onClick={onStart}
      >
        <span aria-hidden="true">◉</span>
        {selectedDraft ? '用语音继续打磨' : '选择草稿后开始'}
      </button>
    </div>
  );
}

export interface VoiceRefinementEntryProps {
  risk: RiskLevel;
  voiceContextToken: VoiceContextToken;
  originalRequest: GuidanceRequest;
  drafts: readonly string[];
  onRefined: (result: VoiceRefinementResponse) => void;
  loadCapabilities?: () => Promise<VoiceCapabilities>;
  controllerFactory?: VoiceRealtimeControllerFactory;
  apiClient?: VoiceApiClient;
}

export function VoiceRefinementEntry({
  risk,
  voiceContextToken,
  originalRequest,
  drafts,
  onRefined,
  loadCapabilities = fetchVoiceCapabilities,
  controllerFactory,
  apiClient
}: VoiceRefinementEntryProps): ReactNode {
  const [capabilities, setCapabilities] = useState<EnabledVoiceCapabilities | null>(null);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState<number | null>(null);
  const [sessionDraft, setSessionDraft] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!canShowVoiceForRisk(risk)) return;
    let current = true;
    void loadCapabilities()
      .then((result) => {
        if (current) setCapabilities(result.enabled ? result : null);
      })
      .catch(() => {
        if (current) setCapabilities(null);
      });
    return () => {
      current = false;
    };
  }, [loadCapabilities, risk]);

  if (!canShowVoiceForRisk(risk) || !capabilities || drafts.length === 0) return null;

  const openSession = () => {
    const draft = normalizeSelectedVoiceDraft(drafts, selectedDraftIndex);
    if (!draft) return;
    setSessionDraft(draft);
    setIsOpen(true);
  };

  return (
    <>
      <section className="voice-entry reveal" aria-labelledby="voice-entry-title">
        <div className="voice-entry__copy">
          <span className="eyebrow">TALK IT THROUGH</span>
          <h2 id="voice-entry-title">选一句，再把你的真实想法说出来</h2>
          <p>先锁定一条回复，再和语音教练聊最多 5 分钟。结束后会根据这轮对话重新生成整份建议。</p>
        </div>
        <VoiceDraftPicker
          drafts={drafts}
          selectedIndex={selectedDraftIndex}
          onSelect={setSelectedDraftIndex}
          onStart={openSession}
        />
      </section>

      {isOpen && sessionDraft ? (
        <VoiceRefinementSheet
          capabilities={capabilities}
          voiceContextToken={voiceContextToken}
          originalRequest={originalRequest}
          selectedDraft={sessionDraft}
          onClose={() => {
            setIsOpen(false);
            setSessionDraft(null);
          }}
          onRefined={(result) => {
            setIsOpen(false);
            setSessionDraft(null);
            setSelectedDraftIndex(null);
            onRefined(result);
          }}
          {...(controllerFactory ? { controllerFactory } : {})}
          {...(apiClient ? { apiClient } : {})}
        />
      ) : null}
    </>
  );
}

export interface VoiceRefinementSheetProps {
  capabilities: EnabledVoiceCapabilities;
  voiceContextToken: VoiceContextToken;
  originalRequest: GuidanceRequest;
  selectedDraft: string;
  onClose: () => void;
  onRefined: (result: VoiceRefinementResponse) => void;
  controllerFactory?: VoiceRealtimeControllerFactory;
  apiClient?: VoiceApiClient;
}

export function VoiceRefinementSheet({
  capabilities,
  voiceContextToken,
  originalRequest,
  selectedDraft,
  onClose,
  onRefined,
  controllerFactory,
  apiClient
}: VoiceRefinementSheetProps): ReactNode {
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const hookOptions: UseRealtimeVoiceOptions = {
    capabilities,
    voiceContextToken,
    originalRequest,
    selectedDraft,
    onRefined,
    ...(controllerFactory ? { controllerFactory } : {}),
    ...(apiClient ? { apiClient } : {})
  };
  const voice = useRealtimeVoice(hookOptions);
  const { state } = voice;
  const active = isActivePhase(state.phase);
  const showConsent = state.phase === 'idle';
  const canMute = state.phase === 'listening';
  const canInterrupt = canInterruptVoicePhase(state.phase);
  const waitingForTurnGate = state.phase === 'transcribing' || state.phase === 'safety_checking';
  const latestUserTranscript = state.turns.at(-1)?.transcript ?? '';

  const closeSheet = () => {
    voice.close();
    onClose();
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="voice-sheet-backdrop" role="presentation">
      <section
        className="voice-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-sheet-title"
        aria-describedby="voice-sheet-description"
      >
        <header className="voice-sheet__header">
          <div>
            <span className="eyebrow">VOICE REFINEMENT</span>
            <h2 id="voice-sheet-title">围绕这一句，把想法聊清楚</h2>
          </div>
          <button className="voice-sheet__close" type="button" onClick={closeSheet} aria-label="关闭语音复盘">
            ×
          </button>
        </header>

        <aside className="voice-selected-draft" aria-label="本轮选中的草稿">
          <span>本轮打磨的回复</span>
          <p>“{selectedDraft}”</p>
        </aside>

        {showConsent ? (
          <div className="voice-consent">
            <p id="voice-sheet-description">
              这是一段最多 5 分钟的复盘。教练会围绕所选回复，帮你确认目标、感受、担忧和边界。
            </p>
            <div className="voice-consent__facts" aria-label="语音处理说明">
              <p><strong>处理方</strong><span>音频、所选草稿、当前分析摘要和关系设置会发送给 OpenAI Realtime · {capabilities.modelLabel} · {capabilities.voiceLabel}；结束后，通过检查的文字转写会交给当前配置的分析模型服务，自动模式可能按 Provider 链尝试。</span></p>
              <p><strong>生成方式</strong><span>点击“结束并用本次转写生成建议”或 5 分钟到时，会使用本轮已完成且已通过安全检查的转写。</span></p>
              <p><strong>请留意</strong><span>转写可能听错；无需逐条勾选，你可以在下一轮继续纠正。</span></p>
              <p><strong>隐私</strong><span>音频和完整转写不由本应用保存；关闭页面后会从当前会话内存清除。</span></p>
            </div>
            <label className="voice-consent__check">
              <input
                type="checkbox"
                checked={adultConfirmed}
                onChange={(event) => setAdultConfirmed(event.target.checked)}
              />
              <span>我已满 18 周岁，并同意将本次音频、所选草稿、当前分析摘要和关系设置发送给 OpenAI 实时处理；结束后，将通过检查的文字转写发送给当前分析模型服务生成新建议。</span>
            </label>
            <button
              className="primary-button voice-consent__start"
              type="button"
              disabled={!adultConfirmed}
              onClick={() => void voice.start()}
            >
              允许麦克风并开始
            </button>
            <p className="voice-consent__fallback">不想使用语音？关闭后仍可直接编辑或复制原来的草稿。</p>
          </div>
        ) : (
          <div className="voice-session" id="voice-sheet-description">
            <div className="voice-session__status" aria-live="polite">
              <div className={`voice-orb voice-orb--${state.phase}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div>
                <strong>{voicePhaseLabel(state.phase)}</strong>
                <span>{formatRemainingTime(state.remainingSeconds)} · 已交流 {state.turns.length} 轮</span>
              </div>
            </div>

            {active || latestUserTranscript || state.assistantSubtitle ? (
              <div className="voice-transcript-pair" aria-live="polite">
                <div className="voice-transcript voice-transcript--user">
                  <span>你</span>
                  <p>{latestUserTranscript || (waitingForTurnGate ? '正在整理你刚才说的话…' : '说说你想怎么表达。')}</p>
                </div>
                <div className="voice-transcript voice-transcript--coach">
                  <span>教练</span>
                  <p>{state.assistantSubtitle || (waitingForTurnGate ? '安全检查完成后，我再回应。' : '我会在这里回应你。')}</p>
                </div>
              </div>
            ) : null}

            {state.phase === 'safety_stop' ? (
              <div className="voice-alert voice-alert--safety" role="alert">
                <strong>这轮先停在安全这里</strong>
                <p>{state.safetyNotice}</p>
                <p>本应用不能联系紧急服务；如有迫在眉睫的危险，请联系当地紧急服务或可信任的人。</p>
              </div>
            ) : null}

            {state.phase === 'error' ? (
              <div className="voice-alert" role="alert">
                <strong>语音暂时没有继续</strong>
                <p>{state.errorMessage}</p>
                <p>原来的文字分析没有改变。</p>
              </div>
            ) : null}

            {state.phase === 'ended' ? (
              <div className="voice-alert" role="status">
                <strong>本次对话已结束</strong>
                <p>本轮没有可用于生成的已完成安全转写，因此没有更新建议。</p>
                <p>原来的文字分析没有改变。</p>
              </div>
            ) : null}

            {state.phase === 'completed' ? (
              <div className="voice-alert voice-alert--success" role="status">
                <strong>建议已根据本次转写更新</strong>
                <p>关闭后就能查看新的分析卡片。</p>
              </div>
            ) : null}

            {active ? (
              <div className="voice-controls" aria-label="语音控制">
                <button type="button" disabled={!canMute} onClick={voice.toggleMute}>
                  {state.muted ? '恢复倾听' : '麦克风静音'}
                </button>
                <button type="button" disabled={!canInterrupt} onClick={voice.interrupt}>
                  打断回应
                </button>
                <button
                  type="button"
                  disabled={waitingForTurnGate}
                  onClick={() => void voice.end()}
                >
                  结束并用本次转写生成建议
                </button>
              </div>
            ) : null}

            <div className="voice-session__actions">
              {state.phase === 'error' ? (
                <button className="secondary-button" type="button" onClick={() => void voice.retry()}>
                  重新开始语音
                </button>
              ) : null}
              {!active && state.phase !== 'refining' ? (
                <button className="secondary-button" type="button" onClick={closeSheet}>
                  回到分析结果
                </button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
