import type { GuidanceProvenance } from '@alc/agent-core';
import {
  ANALYSIS_MODEL_AUTO_ID,
  AnalysisModelIdSchema,
  MAX_CONVERSATION_TEXT_LENGTH,
  MAX_USER_CONTEXT_LENGTH,
  VoiceContextTokenSchema
} from '@alc/contracts';
import type {
  AnalysisModelCatalog,
  AnalysisModelOption,
  GuidanceOutput,
  GuidanceRequest
} from '@alc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  App,
  ContextStep,
  filesFromDataTransfer,
  GuidanceEvidence,
  GuidanceSourceStatus,
  InputStep,
  reconcileAnalysisModelId,
  voiceRefinementResultSnapshot
} from './App';

describe('guidance evidence labels', () => {
  it('visibly separates exact chat quotes from assistant advice', () => {
    const quoteHtml = renderToStaticMarkup(
      <GuidanceEvidence items={[{ kind: 'quote', quote: '这周项目终于快结束了' }]} />
    );
    const adviceHtml = renderToStaticMarkup(
      <GuidanceEvidence items={[{ kind: 'advice' }]} />
    );

    expect(quoteHtml).toContain('聊天原文');
    expect(quoteHtml).toContain('这周项目终于快结束了');
    expect(adviceHtml).toContain('建议');
    expect(adviceHtml).toContain('不是聊天事实');
  });
});

describe('iterative voice result adoption', () => {
  it('adopts the refreshed guidance, request, token, and drafts as one snapshot', () => {
    const guidance = {
      messageOptions: [
        { text: '新一轮草稿 A' },
        { text: '新一轮草稿 B' }
      ]
    } as GuidanceOutput;
    const nextRequest = {
      conversationText: '足够长的原始聊天内容，用于验证第二轮沿用新的请求上下文。'.repeat(2),
      relationshipStage: 'getting_to_know',
      goal: 'invite_to_meet',
      userTone: 'warm',
      analysisModelId: ANALYSIS_MODEL_AUTO_ID,
      context: '第一轮已确认的语音补充。'
    } satisfies GuidanceRequest;
    const freshToken = VoiceContextTokenSchema.parse('n'.repeat(40));

    const snapshot = voiceRefinementResultSnapshot({
      guidance,
      provenance: {
        source: 'remote',
        provider: 'openai-compatible:event-model',
        promptVersion: 'guidance-v4'
      },
      nextRequest,
      voiceContextToken: freshToken
    });

    expect(snapshot).toMatchObject({
      guidance,
      guidanceRequest: nextRequest,
      voiceContextToken: freshToken,
      drafts: ['新一轮草稿 A', '新一轮草稿 B']
    });
  });
});

describe('教恋 A Little Closer welcome screen', () => {
  it('renders the product promise and privacy boundaries', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('教恋');
    expect(html).toContain('A Little Closer');
    expect(html).toContain('你的专属恋爱沟通教练');
    expect(html).toContain('<span>有些靠近，</span><em>从好好说话开始。</em>');
    expect(html).toContain('上传完整聊天记录或相关片段');
    expect(html).toContain('为不擅长表达的工科男生设计');
    expect(html).not.toContain('上传一小段聊天');
    expect(html).toContain('上传聊天，开始分析');
    expect(html).toContain('先看虚构示例');
    expect(html).not.toContain('用脱敏虚构样例看看');
    expect(html).toContain('发现共同话题');
    expect(html).toContain('分析回复节奏');
    expect(html).toContain('建议下一步表达');
    expect(html).not.toContain('不替你发送 · 不判断好感概率');
    expect(html).toContain('分享聊天前的小提醒');
    expect(html).toContain('上传前，记得遮住姓名、头像和联系方式');
    expect(html).toContain('截图只在这次分析中读取，不会长期留在浏览器');
    expect(html).toContain('我会把事实和猜测分开，最后怎么说，由你决定');
  });
});

describe('guidance source status', () => {
  const cases: Array<[GuidanceProvenance | null, string]> = [
    [
      {
        source: 'remote',
        provider: 'eazo-app-ai:deepseek.v3.2',
        promptVersion: 'guidance-v2'
      },
      'Eazo AI 分析'
    ],
    [
      {
        source: 'remote',
        provider: 'openai-compatible:claude-sonnet-4-6',
        promptVersion: 'guidance-v2'
      },
      'AI 模型分析'
    ],
    [{ source: 'local_fallback', provider: 'deterministic-local' }, '基础整理模式'],
    [{ source: 'local_safety', provider: 'deterministic-safety' }, '安全保护模式'],
    [{ source: 'local', provider: 'deterministic-local' }, '本地演示模式'],
    [null, '分析结果']
  ];

  it.each(cases)('renders the expected copy for %#', (provenance, label) => {
    const html = renderToStaticMarkup(<GuidanceSourceStatus provenance={provenance} />);

    expect(html).toContain(label);
  });

  it('shows model metadata only for confirmed remote provenance', () => {
    const remoteHtml = renderToStaticMarkup(
      <GuidanceSourceStatus
        provenance={{
          source: 'remote',
          provider: 'eazo-app-ai:deepseek.v3.2',
          promptVersion: 'guidance-v2'
        }}
      />
    );
    const legacyHtml = renderToStaticMarkup(<GuidanceSourceStatus provenance={null} />);

    expect(remoteHtml).toContain('模型 deepseek.v3.2');
    expect(remoteHtml).toContain('分析规范 guidance-v2');
    expect(legacyHtml).toContain('分析结果');
    expect(legacyHtml).not.toContain('Eazo AI');
  });

  it('shows a generic model label for an OpenAI-compatible provider', () => {
    const html = renderToStaticMarkup(
      <GuidanceSourceStatus
        provenance={{
          source: 'remote',
          provider: 'openai-compatible:claude-sonnet-4-6',
          promptVersion: 'guidance-v2'
        }}
      />
    );

    expect(html).toContain('AI 模型分析');
    expect(html).toContain('模型 claude-sonnet-4-6');
    expect(html).not.toContain('模型 openai-compatible:');
  });
});

describe('screenshot perspective confirmation', () => {
  const screenshot = {
    id: 'screenshot-1',
    file: {} as File,
    previewUrl: 'blob:test-screenshot'
  };
  const baseProps = {
    conversationText: '',
    error: '',
    extractionNotice: '',
    isExtracting: false,
    onBack: () => undefined,
    onConversationChange: () => undefined,
    onFiles: () => undefined,
    onRemoveScreenshot: () => undefined,
    onScreenshotPerspectiveChange: () => undefined,
    onContinue: () => undefined,
    onSample: () => undefined
  };

  it('shows and enforces the own-screen perspective confirmation for screenshots', () => {
    const uncheckedHtml = renderToStaticMarkup(
      <InputStep
        {...baseProps}
        screenshots={[screenshot]}
        screenshotPerspectiveConfirmed={false}
      />
    );
    const confirmedHtml = renderToStaticMarkup(
      <InputStep
        {...baseProps}
        screenshots={[screenshot]}
        screenshotPerspectiveConfirmed
      />
    );
    expect(uncheckedHtml).toContain('截图来自我自己的聊天界面（右侧气泡是我）');
    expect(uncheckedHtml).toContain('点击选择，或拖入 1–3 张截图');
    expect(uncheckedHtml).toContain('转发图片或他人手机截图');
    expect(uncheckedHtml).toContain('disabled=""');
    expect(confirmedHtml).not.toContain('请先阅读并同意远程处理说明');
    expect(confirmedHtml).not.toContain('disabled=""');
  });

  it('does not show or require the confirmation for text-only input', () => {
    const html = renderToStaticMarkup(
      <InputStep
        {...baseProps}
        screenshots={[]}
        screenshotPerspectiveConfirmed={false}
        conversationText={'我：这是一段足够长的文字输入。对方：收到，我们继续聊聊这个共同话题。'.repeat(2)}
      />
    );

    expect(html).not.toContain('截图来自我自己的聊天界面');
    expect(html).not.toContain('主办方模型网关');
    expect(html).not.toContain('disabled=""');
  });

  it('supports full chat transcripts with the shared character limit', () => {
    const html = renderToStaticMarkup(
      <InputStep
        {...baseProps}
        screenshots={[]}
        screenshotPerspectiveConfirmed={false}
      />
    );

    expect(html).toContain('可以粘贴完整聊天记录');
    expect(html).not.toContain('建议 5–20 句');
    expect(html).toContain(`0/${MAX_CONVERSATION_TEXT_LENGTH}`);
    expect(html).toContain(`maxLength="${MAX_CONVERSATION_TEXT_LENGTH}"`);
  });

  it('does not require or describe remote upload in static screenshot mode', () => {
    const html = renderToStaticMarkup(
      <InputStep
        {...baseProps}
        screenshots={[screenshot]}
        screenshotPerspectiveConfirmed
        staticDemoEnabled
      />
    );

    expect(html).toContain('静态演示不会上传或识别截图');
    expect(html).not.toContain('主办方模型网关');
    expect(html).not.toContain('screenshot-remote-processing-consent');
    expect(html).not.toContain('disabled=""');
  });
});

describe('screenshot drag and drop', () => {
  const emptyFileList = {
    length: 0,
    item: () => null
  } as unknown as FileList;

  it('uses files exposed directly by the browser', () => {
    const screenshot = { name: 'chat.png' } as File;
    const files = {
      0: screenshot,
      length: 1,
      item: (index: number) => (index === 0 ? screenshot : null)
    } as unknown as FileList;

    expect(
      filesFromDataTransfer({
        files,
        items: [] as unknown as DataTransferItemList
      })
    ).toEqual([screenshot]);
  });

  it('falls back to file items supplied by another application', () => {
    const screenshot = { name: 'wechat-chat.jpg' } as File;
    const items = [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => screenshot },
      { kind: 'file', getAsFile: () => null }
    ] as unknown as DataTransferItemList;

    expect(filesFromDataTransfer({ files: emptyFileList, items })).toEqual([screenshot]);
  });
});

describe('streamlined submission', () => {
  const eventModelId = AnalysisModelIdSchema.parse('event-gpt41-mini');
  const analysisModels: readonly AnalysisModelOption[] = [
    {
      id: ANALYSIS_MODEL_AUTO_ID,
      label: '自动选择（推荐）',
      description: '优先使用主模型，失败后尝试备用模型。',
      recommended: true
    },
    {
      id: eventModelId,
      label: 'GPT-4.1 mini',
      description: '速度与稳定性优先。',
      recommended: false
    }
  ];
  const contextProps = {
    context: '',
    relationshipStage: 'getting_to_know' as const,
    goal: 'keep_conversation_flowing' as const,
    analysisModelId: ANALYSIS_MODEL_AUTO_ID,
    analysisModels,
    modelCatalogStatus: 'ready' as const,
    error: '',
    isLoading: false,
    onBack: () => undefined,
    onContextChange: () => undefined,
    onStageChange: () => undefined,
    onGoalChange: () => undefined,
    onAnalysisModelChange: () => undefined,
    onReloadModels: () => undefined,
    onSubmit: () => undefined
  };

  it('allows remote analysis without a blocking consent panel', () => {
    const html = renderToStaticMarkup(<ContextStep {...contextProps} />);

    expect(html).not.toContain('guidance-remote-processing-consent');
    expect(html).not.toContain('主办方模型网关');
    expect(html).not.toContain('我已先完成脱敏');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('分析模型');
    expect(html).toContain('自动选择（推荐）');
    expect(html).toContain('只影响文字关系分析');
    expect(html).toContain('截图读取仍会自动选择视觉模型');
    expect(html).not.toContain('你平常更像哪种语气');
    expect(html).toContain(`maxLength="${MAX_USER_CONTEXT_LENGTH}"`);
    expect(html).toContain(`0/${MAX_USER_CONTEXT_LENGTH}`);
  });

  it('associates the model label and explanatory copy with the select', () => {
    const html = renderToStaticMarkup(<ContextStep {...contextProps} />);

    expect(html).toContain('for="analysis-model"');
    expect(html).toContain('id="analysis-model"');
    expect(html).toContain(
      'aria-describedby="analysis-model-description analysis-model-scope"'
    );
    expect(html).toContain('优先使用主模型，失败后尝试备用模型。');
  });

  it('keeps auto available and offers a non-blocking retry when catalog loading fails', () => {
    const html = renderToStaticMarkup(
      <ContextStep {...contextProps} modelCatalogStatus="error" />
    );

    expect(html).toContain('仍可使用“自动选择”');
    expect(html).toContain('重新读取');
    expect(html).toContain('<option value="auto" selected="">');
    expect(html).not.toContain('role="alert"');
  });

  it('disables model changes while an analysis is running', () => {
    const html = renderToStaticMarkup(<ContextStep {...contextProps} isLoading />);

    expect(html).toMatch(/<select[^>]*disabled=""/u);
    expect(html).toContain('正在读懂这段对话…');
  });

  it('keeps the static local analysis path enabled without remote wording', () => {
    const staticModels: readonly AnalysisModelOption[] = [
      {
        id: ANALYSIS_MODEL_AUTO_ID,
        label: '本地基础整理（静态演示）',
        description: '只使用浏览器内的基础规则，不调用远程模型。',
        recommended: true
      }
    ];
    const html = renderToStaticMarkup(
      <ContextStep
        {...contextProps}
        staticDemoEnabled
        analysisModels={staticModels}
      />
    );

    expect(html).toContain('本地静态演示');
    expect(html).toContain('不会把聊天文字发送到模型网关');
    expect(html).not.toContain('主办方模型网关');
    expect(html).not.toContain('guidance-remote-processing-consent');
    expect(html).toContain('本地基础整理（静态演示）');
    expect(html).toMatch(/<select[^>]*disabled=""/u);
    expect(html).toContain('<button class="primary-button" type="submit">');
  });

  it('resets a removed selection to the refreshed catalog default', () => {
    const refreshedCatalog: AnalysisModelCatalog = {
      defaultModelId: ANALYSIS_MODEL_AUTO_ID,
      models: [analysisModels[0]!]
    };

    expect(reconcileAnalysisModelId(eventModelId, refreshedCatalog)).toBe(
      ANALYSIS_MODEL_AUTO_ID
    );
    expect(reconcileAnalysisModelId(ANALYSIS_MODEL_AUTO_ID, refreshedCatalog)).toBe(
      ANALYSIS_MODEL_AUTO_ID
    );
  });
});
