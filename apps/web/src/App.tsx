import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { GuidanceProvenance } from '@alc/agent-core';
import {
  ANALYSIS_MODEL_AUTO_ID,
  MAX_CONVERSATION_TEXT_LENGTH,
  MAX_USER_CONTEXT_LENGTH
} from '@alc/contracts';
import type {
  AnalysisModelCatalog,
  AnalysisModelId,
  AnalysisModelOption,
  ConversationInput,
  EvidenceBasis,
  GuidanceOutput,
  GuidanceRequest,
  VoiceContextToken
} from '@alc/contracts';
import {
  AUTO_ANALYSIS_MODEL_OPTION,
  extractConversation,
  fetchAnalysisModelCatalog,
  requestGuidance,
  STATIC_DEMO_ANALYSIS_MODEL_CATALOG,
  STATIC_DEMO_ENABLED
} from './api';
import {
  depthLabels,
  goals,
  pacingLabels,
  reciprocityLabels,
  relationshipStages,
  sampleContext,
  sampleConversation,
  tones
} from './content';
import { VoiceRefinementEntry } from './voice/VoiceRefinementSheet';
import type { VoiceRefinementResponse } from './voice/voice-api';

type Step = 'welcome' | 'input' | 'review' | 'context' | 'result';
type ModelCatalogStatus = 'loading' | 'ready' | 'error';
const DEFAULT_USER_TONE: ConversationInput['userTone'] = 'natural';

export interface VoiceRefinementResultSnapshot {
  guidance: GuidanceOutput;
  provenance: GuidanceProvenance | null;
  guidanceRequest: GuidanceRequest;
  voiceContextToken: VoiceContextToken | null;
  drafts: string[];
}

export function voiceRefinementResultSnapshot(
  result: VoiceRefinementResponse
): VoiceRefinementResultSnapshot {
  return {
    guidance: result.guidance,
    provenance: result.provenance,
    guidanceRequest: result.nextRequest,
    voiceContextToken: result.voiceContextToken,
    drafts: result.guidance.messageOptions.map((option) => option.text)
  };
}

const INITIAL_ANALYSIS_MODEL_CATALOG: AnalysisModelCatalog = STATIC_DEMO_ENABLED
  ? STATIC_DEMO_ANALYSIS_MODEL_CATALOG
  : {
      defaultModelId: ANALYSIS_MODEL_AUTO_ID,
      models: [AUTO_ANALYSIS_MODEL_OPTION]
    };

interface ScreenshotItem {
  id: string;
  file: File;
  previewUrl: string;
}

type ScreenshotFileCollection = FileList | readonly File[] | null;

export function filesFromDataTransfer(
  dataTransfer: Pick<DataTransfer, 'files' | 'items'>
): File[] {
  const directFiles = Array.from(dataTransfer.files);
  if (directFiles.length > 0) return directFiles;

  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function dataTransferHasFiles(
  dataTransfer: Pick<DataTransfer, 'items' | 'types'>
): boolean {
  return (
    Array.from(dataTransfer.types).includes('Files') ||
    Array.from(dataTransfer.items).some((item) => item.kind === 'file')
  );
}

const stepOrder: readonly Step[] = ['welcome', 'input', 'review', 'context', 'result'];

const stepLabels: Record<Step, string> = {
  welcome: '开始',
  input: '聊天',
  review: '校对',
  context: '心意',
  result: '建议'
};

function cn(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ');
}

export function reconcileAnalysisModelId(
  current: AnalysisModelId,
  catalog: AnalysisModelCatalog
): AnalysisModelId {
  return catalog.models.some((model) => model.id === current)
    ? current
    : catalog.defaultModelId;
}

function ArrowIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

function SparkIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3c.7 4.8 3.2 7.3 8 8-4.8.7-7.3 3.2-8 8-.7-4.8-3.2-7.3-8-8 4.8-.7 7.3-3.2 8-8Z" />
    </svg>
  );
}

function Progress({ current }: { current: Step }): ReactNode {
  const currentIndex = stepOrder.indexOf(current);

  return (
    <nav className="progress" aria-label="体验进度">
      {stepOrder.slice(1).map((step, index) => {
        const absoluteIndex = index + 1;
        const state = absoluteIndex < currentIndex ? 'done' : absoluteIndex === currentIndex ? 'current' : '';
        return (
          <div className={cn('progress__item', state)} key={step} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="progress__dot">{absoluteIndex < currentIndex ? '✓' : absoluteIndex}</span>
            <span>{stepLabels[step]}</span>
          </div>
        );
      })}
    </nav>
  );
}

function PageHeading({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <header className="page-heading reveal">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

function BackButton({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <button className="text-button back-button" type="button" onClick={onClick}>
      <span aria-hidden="true">←</span> 返回上一步
    </button>
  );
}

function FieldLabel({
  htmlFor,
  labelId,
  children,
  note
}: {
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
  note?: string;
}): ReactNode {
  return (
    <div className="field-label">
      <label htmlFor={htmlFor} id={labelId}>{children}</label>
      {note ? <span>{note}</span> : null}
    </div>
  );
}

function Notice({ children, tone = 'sage' }: { children: ReactNode; tone?: 'sage' | 'coral' }): ReactNode {
  return (
    <div className={cn('notice', `notice--${tone}`)}>
      <span className="notice__mark" aria-hidden="true">{tone === 'sage' ? 'i' : '!'}</span>
      <div>{children}</div>
    </div>
  );
}

function AppHeader(): ReactNode {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="教恋 A Little Closer 首页">
        <span className="brand__seal" aria-hidden="true">教恋</span>
        <span>
          <strong>教恋 <i>·</i> A Little Closer</strong>
          <small>你的专属恋爱沟通教练</small>
        </span>
      </a>
    </header>
  );
}

function WelcomeStep({ onBegin, onSample }: { onBegin: () => void; onSample: () => void }): ReactNode {
  return (
    <main className="welcome" id="top">
      <section className="welcome__copy reveal">
        <span className="eyebrow">你的专属恋爱沟通教练</span>
        <h1 aria-label="有些靠近，从好好说话开始。">
          <span>有些靠近，</span>
          <em>从好好说话开始。</em>
        </h1>
        <p className="welcome__lead">
          上传完整聊天记录或相关片段，教恋会帮你看见共同话题、回复节奏和更自然的下一步。为不擅长表达的工科男生设计，也适合每个想把话说清楚的人；建议只是参考，怎么表达仍由你决定。
        </p>
        <ul className="welcome__features" aria-label="主要功能">
          <li><span aria-hidden="true">01</span>发现共同话题</li>
          <li><span aria-hidden="true">02</span>分析回复节奏</li>
          <li><span aria-hidden="true">03</span>建议下一步表达</li>
        </ul>
        <div className="welcome__actions">
          <button className="primary-button" type="button" onClick={onBegin}>
            上传聊天，开始分析 <ArrowIcon />
          </button>
          <button className="secondary-button" type="button" onClick={onSample}>
            <SparkIcon /> 先看虚构示例
          </button>
        </div>
        <p className="microcopy">适用于 18 岁以上用户 · 每次只分析你本次提交的内容</p>
      </section>

      <aside className="letter-card reveal reveal--delay" aria-label="使用前隐私说明">
        <div className="letter-card__stamp" aria-hidden="true">
          <span>ONE</span>
          <strong>STEP</strong>
          <span>CLOSER</span>
        </div>
        <span className="handwritten">Before we begin—</span>
        <h2>分享聊天前的小提醒</h2>
        <ul className="promise-list">
          <li><span>01</span> 上传前，记得遮住姓名、头像和联系方式。</li>
          <li><span>02</span> 截图只在这次分析中读取，不会长期留在浏览器。</li>
          <li><span>03</span> 我会把事实和猜测分开，最后怎么说，由你决定。</li>
        </ul>
        <div className="letter-card__signoff">
          <span>with care,</span>
          <strong>教恋 · A Little Closer</strong>
        </div>
      </aside>
    </main>
  );
}

export function InputStep({
  screenshots,
  screenshotPerspectiveConfirmed,
  conversationText,
  error,
  extractionNotice,
  isExtracting,
  staticDemoEnabled = STATIC_DEMO_ENABLED,
  onBack,
  onConversationChange,
  onFiles,
  onRemoveScreenshot,
  onScreenshotPerspectiveChange,
  onContinue,
  onSample
}: {
  screenshots: readonly ScreenshotItem[];
  screenshotPerspectiveConfirmed: boolean;
  conversationText: string;
  error: string;
  extractionNotice: string;
  isExtracting: boolean;
  staticDemoEnabled?: boolean;
  onBack: () => void;
  onConversationChange: (value: string) => void;
  onFiles: (files: ScreenshotFileCollection) => void;
  onRemoveScreenshot: (id: string) => void;
  onScreenshotPerspectiveChange: (confirmed: boolean) => void;
  onContinue: () => void;
  onSample: () => void;
}): ReactNode {
  const hasEnoughText = conversationText.trim().length >= 40;
  const hasScreenshots = screenshots.length > 0;
  const dragDepthRef = useRef(0);
  const [isDraggingScreenshots, setIsDraggingScreenshots] = useState(false);

  function handleScreenshotDragEnter(event: DragEvent<HTMLLabelElement>): void {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingScreenshots(true);
  }

  function handleScreenshotDragOver(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleScreenshotDragLeave(event: DragEvent<HTMLLabelElement>): void {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingScreenshots(false);
  }

  function handleScreenshotDrop(event: DragEvent<HTMLLabelElement>): void {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingScreenshots(false);
    const droppedFiles = filesFromDataTransfer(event.dataTransfer);
    if (droppedFiles.length > 0) onFiles(droppedFiles);
  }

  return (
    <main className="workspace-page">
      <Progress current="input" />
      <BackButton onClick={onBack} />
      <PageHeading eyebrow="01 / THE CONVERSATION" title="把聊天放在这里">
        可以粘贴完整聊天记录，也可以只保留与问题有关的片段。上传前请先脱敏，并确认“我”和“对方”标注清楚。
      </PageHeading>

      <div className="input-grid reveal reveal--delay">
        <section className="paper-panel upload-panel">
          <FieldLabel htmlFor="screenshots" note={`${screenshots.length}/3`}>
            上传聊天截图
          </FieldLabel>
          <label
            className={cn('upload-box', isDraggingScreenshots && 'upload-box--dragging')}
            htmlFor="screenshots"
            onDragEnter={handleScreenshotDragEnter}
            onDragOver={handleScreenshotDragOver}
            onDragLeave={handleScreenshotDragLeave}
            onDrop={handleScreenshotDrop}
          >
            <span className="upload-box__icon" aria-hidden="true">＋</span>
            <strong aria-live="polite">
              {isDraggingScreenshots ? '松手添加截图' : '点击选择，或拖入 1–3 张截图'}
            </strong>
            <span>
              {isDraggingScreenshots ? '支持 PNG 或 JPG' : 'PNG 或 JPG，单张不超过 5 MB'}
            </span>
            <input
              id="screenshots"
              type="file"
              accept="image/png,image/jpeg"
              multiple
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                onFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </label>

          {screenshots.length > 0 ? (
            <>
              <div className="preview-strip" aria-label="已选择的截图">
                {screenshots.map((item, index) => (
                  <figure className="preview" key={item.id}>
                    <img src={item.previewUrl} alt={`聊天截图 ${index + 1}`} />
                    <figcaption>{index + 1}</figcaption>
                    <button
                      type="button"
                      onClick={() => onRemoveScreenshot(item.id)}
                      aria-label={`移除聊天截图 ${index + 1}`}
                    >
                      ×
                    </button>
                  </figure>
                ))}
              </div>
              <div className="perspective-confirmation">
                <label>
                  <input
                    type="checkbox"
                    checked={screenshotPerspectiveConfirmed}
                    onChange={(event) => onScreenshotPerspectiveChange(event.target.checked)}
                  />
                  <span>
                    <strong>截图来自我自己的聊天界面（右侧气泡是我）</strong>
                  </span>
                </label>
                <p>如果是转发图片或他人手机截图，请改用文字输入，并手动标注“我：”和“对方：”。</p>
              </div>
            </>
          ) : null}
        </section>

        <div className="or-divider"><span>或者</span></div>

        <section className="paper-panel paste-panel">
          <FieldLabel
            htmlFor="conversation"
            note={`${conversationText.length}/${MAX_CONVERSATION_TEXT_LENGTH}`}
          >
            粘贴聊天文字
          </FieldLabel>
          <textarea
            id="conversation"
            value={conversationText}
            maxLength={MAX_CONVERSATION_TEXT_LENGTH}
            rows={11}
            placeholder={'我：……\n对方：……\n我：……'}
            onChange={(event) => onConversationChange(event.target.value)}
          />
          <button className="sample-link" type="button" onClick={onSample}>
            没有合适的记录？填入脱敏虚构样例
          </button>
        </section>
      </div>

      {extractionNotice ? <Notice>{extractionNotice}</Notice> : null}
      {error ? <div className="error-message" role="alert">{error}</div> : null}

      <div className="sticky-action">
        <p>
          {hasScreenshots
            ? !screenshotPerspectiveConfirmed
              ? '请先确认截图视角，避免把双方消息标反。'
              : staticDemoEnabled
                ? '静态演示不会上传或识别截图；下一步请手工粘贴并校对聊天文字。'
                : '点击后会读取截图；你可以在下一步校对文字。'
            : hasEnoughText
              ? '下一步先校对文字，不会立刻开始分析。'
              : '请上传截图，或至少粘贴 40 个字。'}
        </p>
        <button
          className="primary-button"
          type="button"
          disabled={
            isExtracting ||
            (!hasScreenshots && !hasEnoughText) ||
            (hasScreenshots && !screenshotPerspectiveConfirmed)
          }
          onClick={onContinue}
        >
          {isExtracting
            ? staticDemoEnabled
              ? '正在打开校对页…'
              : '正在读取截图…'
            : hasScreenshots
              ? staticDemoEnabled
                ? '转到手工校对'
                : '读取并校对'
              : '继续校对'}
          {!isExtracting ? <ArrowIcon /> : <span className="spinner" aria-hidden="true" />}
        </button>
      </div>
    </main>
  );
}

function ReviewStep({
  conversationText,
  extractionNotice,
  onBack,
  onChange,
  onContinue
}: {
  conversationText: string;
  extractionNotice: string;
  onBack: () => void;
  onChange: (value: string) => void;
  onContinue: () => void;
}): ReactNode {
  const length = conversationText.trim().length;

  return (
    <main className="workspace-page workspace-page--narrow">
      <Progress current="review" />
      <BackButton onClick={onBack} />
      <PageHeading eyebrow="02 / A QUICK CHECK" title="先确认我们读对了">
        OCR 可能认错名字、表情或说话人。请把角色统一改成“我”和“对方”，也可以删掉不想分析的句子。
      </PageHeading>

      {extractionNotice ? <Notice>{extractionNotice}</Notice> : null}

      <section className="paper-panel transcript-card reveal reveal--delay">
        <div className="transcript-card__tape" aria-hidden="true" />
        <FieldLabel
          htmlFor="review-text"
          note={`${conversationText.length}/${MAX_CONVERSATION_TEXT_LENGTH}`}
        >
          聊天文字
        </FieldLabel>
        <textarea
          id="review-text"
          className="transcript-editor"
          value={conversationText}
          maxLength={MAX_CONVERSATION_TEXT_LENGTH}
          rows={16}
          onChange={(event) => onChange(event.target.value)}
        />
      </section>

      <Notice>
        <strong>请只保留当前分析需要的内容。</strong>
        <p>Agent 只能根据这段文字提出可能的解释，不会判断对方“到底怎么想”。</p>
      </Notice>

      <div className="sticky-action">
        <p>{length < 40 ? `还需要 ${40 - length} 个字，才能得到有意义的分析。` : '文字确认后，再告诉我们你想往哪里走。'}</p>
        <button className="primary-button" type="button" disabled={length < 40} onClick={onContinue}>
          文字确认无误 <ArrowIcon />
        </button>
      </div>
    </main>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  options,
  value,
  onChange
}: {
  legend: string;
  options: ReadonlyArray<{ value: T; label: string; note?: string }>;
  value: T;
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      <div className="choice-grid">
        {options.map((option) => (
          <label className={cn('choice-card', value === option.value && 'selected')} key={option.value}>
            <input
              type="radio"
              name={legend}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="choice-card__radio" aria-hidden="true" />
            <span>
              <strong>{option.label}</strong>
              {option.note ? <small>{option.note}</small> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ContextStep({
  context,
  relationshipStage,
  goal,
  analysisModelId,
  analysisModels,
  modelCatalogStatus,
  error,
  isLoading,
  staticDemoEnabled = STATIC_DEMO_ENABLED,
  onBack,
  onContextChange,
  onStageChange,
  onGoalChange,
  onAnalysisModelChange,
  onReloadModels,
  onSubmit
}: {
  context: string;
  relationshipStage: ConversationInput['relationshipStage'];
  goal: ConversationInput['goal'];
  analysisModelId: AnalysisModelId;
  analysisModels: readonly AnalysisModelOption[];
  modelCatalogStatus: ModelCatalogStatus;
  error: string;
  isLoading: boolean;
  staticDemoEnabled?: boolean;
  onBack: () => void;
  onContextChange: (value: string) => void;
  onStageChange: (value: ConversationInput['relationshipStage']) => void;
  onGoalChange: (value: ConversationInput['goal']) => void;
  onAnalysisModelChange: (value: AnalysisModelId) => void;
  onReloadModels: () => void;
  onSubmit: () => void;
}): ReactNode {
  const selectedModel =
    analysisModels.find((model) => model.id === analysisModelId) ?? analysisModels[0];
  const modelDescriptionIds = [
    'analysis-model-description',
    'analysis-model-scope',
    modelCatalogStatus === 'ready' ? undefined : 'analysis-model-status'
  ]
    .filter((id): id is string => id !== undefined)
    .join(' ');

  return (
    <main className="workspace-page">
      <Progress current="context" />
      <BackButton onClick={onBack} />
      <PageHeading eyebrow="03 / YOUR INTENTION" title="你希望更靠近哪一步？">
        同一句话放在不同关系阶段，含义会很不一样。选择最接近的情况，不需要做到绝对准确。
      </PageHeading>

      <form
        className="context-form reveal reveal--delay"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <ChoiceGroup
          legend="你们现在的关系"
          options={relationshipStages}
          value={relationshipStage}
          onChange={onStageChange}
        />
        <ChoiceGroup legend="这次聊天的目标" options={goals} value={goal} onChange={onGoalChange} />

        <div className="context-field">
          <FieldLabel htmlFor="context-note" note="选填">
            还有什么背景值得知道？
          </FieldLabel>
          <textarea
            id="context-note"
            value={context}
            maxLength={MAX_USER_CONTEXT_LENGTH}
            rows={4}
            placeholder="例如：认识两周、上次见面聊过某件事，或你不希望越过的边界……"
            onChange={(event) => onContextChange(event.target.value)}
          />
          <span className="character-count">{context.length}/{MAX_USER_CONTEXT_LENGTH}</span>
        </div>

        <section className="model-picker" aria-labelledby="analysis-model-label">
          <FieldLabel
            htmlFor="analysis-model"
            labelId="analysis-model-label"
            note={staticDemoEnabled ? '静态演示' : '可随时调整'}
          >
            分析模型
          </FieldLabel>
          <div className="model-picker__control">
            <select
              id="analysis-model"
              value={selectedModel?.id ?? analysisModelId}
              disabled={isLoading || staticDemoEnabled}
              aria-describedby={modelDescriptionIds}
              onChange={(event) => {
                const nextModel = analysisModels.find(
                  (model) => model.id === event.target.value
                );
                if (nextModel) onAnalysisModelChange(nextModel.id);
              }}
            >
              {analysisModels.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label}
                  {model.recommended && !model.label.includes('推荐') ? '（推荐）' : ''}
                </option>
              ))}
            </select>
            <span className="model-picker__chevron" aria-hidden="true">⌄</span>
          </div>
          <p className="model-picker__description" id="analysis-model-description">
            {selectedModel?.description ?? '保持自动选择，由服务端决定可用模型。'}
          </p>
          <p className="model-picker__scope" id="analysis-model-scope">
            此选项只影响文字关系分析；截图读取仍会自动选择视觉模型。
          </p>
          {modelCatalogStatus === 'loading' ? (
            <p className="model-catalog-status" id="analysis-model-status" role="status">
              正在读取可用模型；你也可以先保持“自动选择”继续。
            </p>
          ) : null}
          {modelCatalogStatus === 'error' ? (
            <div className="model-catalog-status" id="analysis-model-status" role="status">
              <span>暂时没拿到最新模型列表，仍可使用“自动选择”。</span>
              <button type="button" onClick={onReloadModels}>重新读取</button>
            </div>
          ) : null}
        </section>

        {error ? <div className="error-message" role="alert">{error}</div> : null}

        {staticDemoEnabled ? (
          <Notice>
            本地静态演示只使用浏览器内的基础规则，不会把聊天文字发送到模型网关。
          </Notice>
        ) : null}

        <div className="submit-letter">
          <div>
            <span className="handwritten">A gentle reminder—</span>
            <p>分析不会给出“好感概率”，也不会建议试探、欺骗或制造嫉妒。</p>
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? '正在读懂这段对话…' : '看看自然的下一步'}
            {isLoading ? <span className="spinner" aria-hidden="true" /> : <SparkIcon />}
          </button>
        </div>
      </form>
    </main>
  );
}

export function GuidanceEvidence({
  items
}: {
  items: readonly EvidenceBasis[];
}): ReactNode {
  return (
    <div className="guidance-evidence" aria-label="判断依据">
      {items.map((basis, index) =>
        basis.kind === 'quote' ? (
          <blockquote className="guidance-evidence__item guidance-evidence__item--quote" key={`${basis.quote}-${index}`}>
            <span>聊天原文</span>
            <q>{basis.quote}</q>
          </blockquote>
        ) : (
          <p className="guidance-evidence__item guidance-evidence__item--advice" key={`advice-${index}`}>
            <span>建议</span>
            这是行动建议，不是聊天事实
          </p>
        )
      )}
    </div>
  );
}

function ResultList({
  items,
  evidenceSets,
  emptyText
}: {
  items: readonly string[];
  evidenceSets?: ReadonlyArray<readonly EvidenceBasis[]>;
  emptyText: string;
}): ReactNode {
  if (items.length === 0) {
    return <p className="empty-note">{emptyText}</p>;
  }

  return (
    <ul className="result-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <p>{item}</p>
            {evidenceSets?.[index] ? <GuidanceEvidence items={evidenceSets[index]} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

interface SourceStatusCopy {
  label: string;
  detail: string;
  tone: 'remote' | 'fallback' | 'safety' | 'local' | 'neutral';
}

function sourceStatusCopy(provenance: GuidanceProvenance | null): SourceStatusCopy {
  switch (provenance?.source) {
    case 'remote':
      return {
        label: provenance.provider?.startsWith('eazo-app-ai:')
          ? 'Eazo AI 分析'
          : 'AI 模型分析',
        detail: '由远程模型整理，并经过本地安全检查。建议仍请结合真实交流判断。',
        tone: 'remote'
      };
    case 'local_fallback':
      return {
        label: '基础整理模式',
        detail: '远程分析暂时不可用，本次已自动切换到本地基础整理，你仍可以继续使用结果。',
        tone: 'fallback'
      };
    case 'local_safety':
      return {
        label: '安全保护模式',
        detail: '系统先应用了安全边界规则，因此本次不展示普通关系建议。',
        tone: 'safety'
      };
    case 'local':
      return {
        label: '本地演示模式',
        detail: '本次由浏览器或服务内的本地规则生成，没有调用远程模型。',
        tone: 'local'
      };
    default:
      return {
        label: '分析结果',
        detail: '以下内容用于整理思路，请结合真实交流判断。',
        tone: 'neutral'
      };
  }
}

function remoteProvenanceMeta(provenance: GuidanceProvenance | null): string | undefined {
  if (provenance?.source !== 'remote') return undefined;
  const provider = provenance.provider?.replace(/^(?:eazo-app-ai|openai-compatible):/u, '');
  const items = [
    provider ? `模型 ${provider}` : undefined,
    provenance.promptVersion ? `分析规范 ${provenance.promptVersion}` : undefined
  ].filter((item): item is string => item !== undefined);
  return items.length > 0 ? items.join(' · ') : undefined;
}

export function GuidanceSourceStatus({
  provenance
}: {
  provenance: GuidanceProvenance | null;
}): ReactNode {
  const copy = sourceStatusCopy(provenance);
  const meta = remoteProvenanceMeta(provenance);

  return (
    <section
      className={cn('source-status', `source-status--${copy.tone}`)}
      aria-label="分析来源"
      role="status"
    >
      <span className="source-status__mark" aria-hidden="true">◎</span>
      <div className="source-status__copy">
        <strong>{copy.label}</strong>
        <p>{copy.detail}</p>
      </div>
      {meta ? <small>{meta}</small> : null}
    </section>
  );
}

function ResultStep({
  guidance,
  provenance,
  drafts,
  copyStatus,
  onDraftChange,
  onCopy,
  onStartOver,
  onAdjust,
  originalRequest,
  voiceContextToken,
  onVoiceRefined
}: {
  guidance: GuidanceOutput;
  provenance: GuidanceProvenance | null;
  drafts: readonly string[];
  copyStatus: number | null;
  onDraftChange: (index: number, value: string) => void;
  onCopy: (index: number) => void;
  onStartOver: () => void;
  onAdjust: () => void;
  originalRequest: GuidanceRequest | null;
  voiceContextToken: VoiceContextToken | null;
  onVoiceRefined: (result: VoiceRefinementResponse) => void;
}): ReactNode {
  const isElevatedRisk = guidance.risk.level === 'high' || guidance.risk.level === 'crisis';

  return (
    <main className="workspace-page result-page">
      <Progress current="result" />
      <PageHeading eyebrow="04 / A WAY FORWARD" title="这是这段对话留下的线索">
        不是答案，更不是对方内心的判词。把它当成一封帮你整理思路的回信。
      </PageHeading>

      <GuidanceSourceStatus provenance={provenance} />

      {guidance.risk.level !== 'low' ? (
        <div className={cn('risk-note', isElevatedRisk && 'risk-note--urgent')} role={isElevatedRisk ? 'alert' : 'status'}>
          <strong>{isElevatedRisk ? '先把安全放在聊天之前' : '有一件事值得先留意'}</strong>
          <p>{guidance.risk.notice}</p>
        </div>
      ) : null}

      <section className="summary-letter reveal">
        <div className="summary-letter__meta">
          <span>FIELD NOTES</span>
          <span>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date())}</span>
        </div>
        <p>{guidance.summary}</p>
        <GuidanceEvidence items={guidance.summaryEvidence} />
        <div className="depth-ribbon">
          <span>推荐的聊天深度</span>
          <strong>{depthLabels[guidance.recommendedDepth]}</strong>
        </div>
      </section>

      <div className="result-grid">
        <section className="result-card reveal reveal--delay">
          <span className="result-card__number">01</span>
          <h2>可以继续的话题</h2>
          <p className="result-card__intro">双方都给过回应的部分，是最自然的入口。</p>
          <ResultList
            items={guidance.mutualTopics}
            evidenceSets={guidance.mutualTopicEvidence}
            emptyText="这段记录里暂时没有足够明确的共同话题。"
          />
        </section>

        <section className="result-card result-card--sage reveal reveal--delay-2">
          <span className="result-card__number">02</span>
          <h2>还没说完的线索</h2>
          <p className="result-card__intro">回访旧话题，通常比突然换话题更自然。</p>
          <ResultList
            items={guidance.openLoops}
            evidenceSets={guidance.openLoopEvidence}
            emptyText="暂时没有明显未完线索，可以先保持轻松。"
          />
        </section>
      </div>

      <section className="rhythm-card reveal">
        <div>
          <span className="eyebrow">THE RHYTHM BETWEEN YOU</span>
          <h2>互动节奏</h2>
        </div>
        <div className="rhythm-card__signals">
          <span>{reciprocityLabels[guidance.interactionPattern.reciprocity]}</span>
          <span>{pacingLabels[guidance.interactionPattern.pacing]}</span>
        </div>
        <p>{guidance.interactionPattern.observation}</p>
        <GuidanceEvidence items={guidance.interactionPattern.evidence} />
      </section>

      <section className="bridge-section reveal">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">CONVERSATION BRIDGES</span>
            <h2>把话题自然地接过去</h2>
          </div>
          <span className="handwritten">not a script, just a bridge</span>
        </div>
        <div className="bridge-list">
          {guidance.topicBridges.map((bridge, index) => (
            <article className="bridge" key={`${bridge.from}-${bridge.to}-${index}`}>
              <div className="bridge__route">
                <span>{bridge.from}</span>
                <i aria-hidden="true" />
                <span>{bridge.to}</span>
              </div>
              <p>“{bridge.prompt}”</p>
              <GuidanceEvidence items={bridge.evidence} />
            </article>
          ))}
        </div>
      </section>

      <section className="messages-section reveal">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">WORDS IN YOUR VOICE</span>
            <h2>试着这样开口</h2>
          </div>
          <p>可以编辑，再决定是否复制。我们永远不会替你发送。</p>
        </div>

        <div className="message-options">
          {guidance.messageOptions.map((option, index) => (
            <article className="message-card" key={`${option.style}-${index}`}>
              <div className="message-card__header">
                <span>OPTION {String(index + 1).padStart(2, '0')}</span>
                <span>{tones.find((tone) => tone.value === option.style)?.label ?? option.style}</span>
              </div>
              <textarea
                value={drafts[index] ?? option.text}
                rows={4}
                aria-label={`可编辑消息选项 ${index + 1}`}
                onChange={(event) => onDraftChange(index, event.target.value)}
              />
              <div className="message-card__why">
                <p><strong>为什么：</strong>{option.why}</p>
                <p><strong>留意：</strong>{option.watchFor}</p>
                <GuidanceEvidence items={option.evidence} />
              </div>
              <button className="copy-button" type="button" onClick={() => onCopy(index)}>
                {copyStatus === index ? '已复制到剪贴板' : '复制这句话'}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="uncertainty-card reveal">
        <span className="handwritten">What we cannot know—</span>
        <h2>这些地方仍然不确定</h2>
        <ResultList items={guidance.uncertainties} emptyText="没有额外的不确定项；仍请以真实交流为准。" />
      </section>

      <section className="next-step-card reveal">
        <span className="next-step-card__mark">→</span>
        <div>
          <span className="eyebrow">ONE SMALL NEXT STEP</span>
          <h2>{guidance.nextStep}</h2>
          <GuidanceEvidence items={guidance.nextStepEvidence} />
        </div>
      </section>

      {voiceContextToken && originalRequest ? (
        <VoiceRefinementEntry
          risk={guidance.risk.level}
          voiceContextToken={voiceContextToken}
          originalRequest={originalRequest}
          drafts={drafts}
          onRefined={onVoiceRefined}
        />
      ) : null}

      <div className="result-actions">
        <button className="secondary-button" type="button" onClick={onAdjust}>调整关系和目标</button>
        <button className="primary-button" type="button" onClick={onStartOver}>分析另一段聊天 <ArrowIcon /></button>
      </div>
      <p className="result-footnote">教恋 · A Little Closer 提供沟通辅助，不替代你的判断，也不保证关系结果。</p>
    </main>
  );
}

export function App(): ReactNode {
  const [step, setStep] = useState<Step>('welcome');
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const screenshotsRef = useRef<ScreenshotItem[]>([]);
  const [screenshotPerspectiveConfirmed, setScreenshotPerspectiveConfirmed] = useState(false);
  const [conversationText, setConversationText] = useState('');
  const [context, setContext] = useState('');
  const [relationshipStage, setRelationshipStage] = useState<ConversationInput['relationshipStage']>('getting_to_know');
  const [goal, setGoal] = useState<ConversationInput['goal']>('keep_conversation_flowing');
  const [analysisModelCatalog, setAnalysisModelCatalog] = useState<AnalysisModelCatalog>(
    INITIAL_ANALYSIS_MODEL_CATALOG
  );
  const [analysisModelId, setAnalysisModelId] = useState<AnalysisModelId>(
    INITIAL_ANALYSIS_MODEL_CATALOG.defaultModelId
  );
  const [modelCatalogStatus, setModelCatalogStatus] = useState<ModelCatalogStatus>(
    STATIC_DEMO_ENABLED ? 'ready' : 'loading'
  );
  const [modelCatalogRefresh, setModelCatalogRefresh] = useState(0);
  const [guidance, setGuidance] = useState<GuidanceOutput | null>(null);
  const [guidanceProvenance, setGuidanceProvenance] = useState<GuidanceProvenance | null>(null);
  const [guidanceRequest, setGuidanceRequest] = useState<GuidanceRequest | null>(null);
  const [voiceContextToken, setVoiceContextToken] = useState<VoiceContextToken | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [extractionNotice, setExtractionNotice] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<number | null>(null);

  useEffect(() => {
    screenshotsRef.current = screenshots;
  }, [screenshots]);

  useEffect(() => {
    if (screenshots.length === 0) setScreenshotPerspectiveConfirmed(false);
  }, [screenshots.length]);

  useEffect(() => {
    if (STATIC_DEMO_ENABLED) return;

    let isCurrent = true;
    setModelCatalogStatus('loading');
    void fetchAnalysisModelCatalog()
      .then((catalog) => {
        if (!isCurrent) return;
        setAnalysisModelCatalog(catalog);
        setAnalysisModelId((current) => reconcileAnalysisModelId(current, catalog));
        setModelCatalogStatus('ready');
      })
      .catch(() => {
        if (isCurrent) setModelCatalogStatus('error');
      });

    return () => {
      isCurrent = false;
    };
  }, [modelCatalogRefresh]);

  useEffect(() => {
    return () => {
      screenshotsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  function clearScreenshots(): void {
    screenshots.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setScreenshots([]);
    setScreenshotPerspectiveConfirmed(false);
  }

  function addFiles(fileList: ScreenshotFileCollection): void {
    setError('');
    if (!fileList) return;

    const incoming = Array.from(fileList);
    if (screenshots.length + incoming.length > 3) {
      setError('最多选择 3 张截图，请先移除一张再添加。');
      return;
    }

    const invalid = incoming.find(
      (file) => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024
    );
    if (invalid) {
      setError(`“${invalid.name}”不是 PNG/JPG，或超过了 5 MB。`);
      return;
    }

    const nextItems = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file)
    }));
    setScreenshotPerspectiveConfirmed(false);
    setScreenshots((current) => [...current, ...nextItems]);
    setExtractionNotice(
      STATIC_DEMO_ENABLED
        ? '图片只保留在当前页面；静态演示不会上传或自动识别，请在下一步手工粘贴聊天文字。'
        : '图片目前只保留在这个页面里；点击读取后才会发送到处理服务。'
    );
  }

  function removeScreenshot(id: string): void {
    setScreenshots((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function useSample(targetStep: Step = 'review'): void {
    clearScreenshots();
    setConversationText(sampleConversation);
    setContext(sampleContext);
    setRelationshipStage('getting_to_know');
    setGoal('invite_to_meet');
    setAnalysisModelId(ANALYSIS_MODEL_AUTO_ID);
    setExtractionNotice('这是虚构且已脱敏的演示对话，你可以自由修改。');
    setError('');
    setStep(targetStep);
  }

  async function continueFromInput(): Promise<void> {
    setError('');
    if (screenshots.length === 0) {
      setStep('review');
      return;
    }
    if (!screenshotPerspectiveConfirmed) {
      setError('请先确认截图来自你自己的聊天界面，并确认右侧气泡代表你。');
      return;
    }

    setIsExtracting(true);
    try {
      const response = await extractConversation(screenshots.map((item) => item.file));
      const extracted = response.extractedText.trim();
      if (extracted) {
        setConversationText((current) => [current.trim(), extracted].filter(Boolean).join('\n\n'));
      }
      setExtractionNotice(
        response.notice ||
          (response.requiresManualReview
            ? '请仔细校对自动识别的文字。'
            : '截图读取完成，请确认文字和说话人是否正确。')
      );
      setStep('review');
    } catch (requestError) {
      setExtractionNotice('暂时没能自动读取截图。你仍可以在下一步手动粘贴或输入聊天文字。');
      setError(requestError instanceof Error ? requestError.message : '截图读取失败，请稍后再试。');
      setStep('review');
    } finally {
      setIsExtracting(false);
    }
  }

  async function submitGuidance(): Promise<void> {
    setError('');
    setIsLoading(true);

    const trimmedContext = context.trim();
    const input: GuidanceRequest = {
      conversationText: conversationText.trim(),
      relationshipStage,
      goal,
      userTone: DEFAULT_USER_TONE,
      analysisModelId,
      ...(trimmedContext ? { context: trimmedContext } : {})
    };

    try {
      const result = await requestGuidance(input);
      setGuidance(result.guidance);
      setGuidanceProvenance(result.provenance);
      setGuidanceRequest(input);
      setVoiceContextToken(result.voiceContextToken ?? null);
      setDrafts(result.guidance.messageOptions.map((option) => option.text));
      setStep('result');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '暂时无法生成建议，请稍后再试。');
    } finally {
      setIsLoading(false);
    }
  }

  function updateDraft(index: number, value: string): void {
    setDrafts((current) => current.map((draft, draftIndex) => (draftIndex === index ? value : draft)));
  }

  async function copyDraft(index: number): Promise<void> {
    const draft = drafts[index];
    if (!draft) return;

    try {
      await navigator.clipboard.writeText(draft);
      setCopyStatus(index);
      window.setTimeout(() => setCopyStatus(null), 1800);
    } catch {
      setCopyStatus(null);
    }
  }

  function startOver(): void {
    clearScreenshots();
    setConversationText('');
    setContext('');
    setGuidance(null);
    setGuidanceProvenance(null);
    setGuidanceRequest(null);
    setVoiceContextToken(null);
    setDrafts([]);
    setError('');
    setExtractionNotice('');
    setCopyStatus(null);
    setStep('input');
  }

  return (
    <div className="app-shell">
      <AppHeader />
      {step === 'welcome' ? <WelcomeStep onBegin={() => setStep('input')} onSample={() => useSample()} /> : null}
      {step === 'input' ? (
        <InputStep
          screenshots={screenshots}
          screenshotPerspectiveConfirmed={screenshotPerspectiveConfirmed}
          conversationText={conversationText}
          error={error}
          extractionNotice={extractionNotice}
          isExtracting={isExtracting}
          onBack={() => setStep('welcome')}
          onConversationChange={setConversationText}
          onFiles={addFiles}
          onRemoveScreenshot={removeScreenshot}
          onScreenshotPerspectiveChange={(confirmed) => {
            setScreenshotPerspectiveConfirmed(confirmed);
            if (confirmed) setError('');
          }}
          onContinue={() => void continueFromInput()}
          onSample={() => useSample('review')}
        />
      ) : null}
      {step === 'review' ? (
        <ReviewStep
          conversationText={conversationText}
          extractionNotice={extractionNotice}
          onBack={() => setStep('input')}
          onChange={setConversationText}
          onContinue={() => setStep('context')}
        />
      ) : null}
      {step === 'context' ? (
        <ContextStep
          context={context}
          relationshipStage={relationshipStage}
          goal={goal}
          analysisModelId={analysisModelId}
          analysisModels={analysisModelCatalog.models}
          modelCatalogStatus={modelCatalogStatus}
          error={error}
          isLoading={isLoading}
          onBack={() => setStep('review')}
          onContextChange={setContext}
          onStageChange={setRelationshipStage}
          onGoalChange={setGoal}
          onAnalysisModelChange={setAnalysisModelId}
          onReloadModels={() => setModelCatalogRefresh((current) => current + 1)}
          onSubmit={() => void submitGuidance()}
        />
      ) : null}
      {step === 'result' && guidance ? (
        <ResultStep
          guidance={guidance}
          provenance={guidanceProvenance}
          drafts={drafts}
          copyStatus={copyStatus}
          onDraftChange={updateDraft}
          onCopy={(index) => void copyDraft(index)}
          onStartOver={startOver}
          onAdjust={() => setStep('context')}
          originalRequest={guidanceRequest}
          voiceContextToken={voiceContextToken}
          onVoiceRefined={(result) => {
            const next = voiceRefinementResultSnapshot(result);
            setGuidance(next.guidance);
            setGuidanceProvenance(next.provenance);
            setGuidanceRequest(next.guidanceRequest);
            setVoiceContextToken(next.voiceContextToken);
            setDrafts(next.drafts);
          }}
        />
      ) : null}
      <footer className="site-footer">
        <span>教恋 · A Little Closer © 2026</span>
        <span>沟通辅助，不代替你的判断</span>
      </footer>
    </div>
  );
}
