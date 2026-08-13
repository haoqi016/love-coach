import {
  ANALYSIS_MODEL_AUTO_ID,
  AnalysisModelCatalogSchema,
  VoiceContextTokenSchema
} from '@alc/contracts';
import type {
  AnalysisModelCatalog,
  AnalysisModelOption,
  ConversationInput,
  GuidanceOutput,
  GuidanceRequest,
  VoiceContextToken
} from '@alc/contracts';
import type { GuidanceProvenance, GuidanceSource } from '@alc/agent-core';

export const STATIC_DEMO_ENABLED = import.meta.env.VITE_STATIC_DEMO === 'true';
export const BROWSER_REQUEST_TIMEOUT_MS = 70_000;
export const MODEL_CATALOG_REQUEST_TIMEOUT_MS = 8_000;

export const AUTO_ANALYSIS_MODEL_OPTION: AnalysisModelOption = {
  id: ANALYSIS_MODEL_AUTO_ID,
  label: '自动选择（推荐）',
  description: '优先使用主模型，暂时不可用时会自动尝试备用方案。',
  recommended: true
};

export const STATIC_DEMO_ANALYSIS_MODEL_CATALOG: AnalysisModelCatalog = {
  defaultModelId: ANALYSIS_MODEL_AUTO_ID,
  models: [
    {
      id: ANALYSIS_MODEL_AUTO_ID,
      label: '本地基础整理（静态演示）',
      description: '只使用浏览器内的基础规则，不调用远程模型。',
      recommended: true
    }
  ]
};

interface ExtractResponse {
  extractedText: string;
  requiresManualReview: boolean;
  notice: string;
}

interface ErrorPayload {
  error?: string | {
    code?: string;
    message?: string;
  };
  message?: string;
}

export interface GuidanceResponse {
  guidance: GuidanceOutput;
  provenance: GuidanceProvenance | null;
  voiceContextToken?: VoiceContextToken;
}

const guidanceSources: readonly GuidanceSource[] = [
  'remote',
  'local_fallback',
  'local_safety',
  'local'
];
const SAFE_PROVENANCE_METADATA = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u;

function isGuidanceSource(value: string): value is GuidanceSource {
  return (guidanceSources as readonly string[]).includes(value);
}

function readProvenanceMetadata(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)?.trim();
  return value && SAFE_PROVENANCE_METADATA.test(value) ? value : undefined;
}

export function readGuidanceProvenance(headers: Headers): GuidanceProvenance | null {
  const source = headers.get('x-alc-guidance-source')?.trim();
  if (!source || !isGuidanceSource(source)) return null;

  const provider = readProvenanceMetadata(headers, 'x-alc-guidance-provider');
  const promptVersion = readProvenanceMetadata(headers, 'x-alc-prompt-version');
  return {
    source,
    ...(provider ? { provider } : {}),
    ...(promptVersion ? { promptVersion } : {})
  };
}

function readVoiceContextToken(headers: Headers): VoiceContextToken | undefined {
  const candidate = headers.get('x-alc-voice-context-token')?.trim();
  if (!candidate) return undefined;
  const parsed = VoiceContextTokenSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ErrorPayload;
    if (payload.message) return payload.message;
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error?.message) return payload.error.message;
    return `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function requestWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = BROWSER_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('等待时间有点久，请检查网络后再试一次。', { cause: error });
    }
    throw new Error('暂时连接不上服务，请稍后再试。', { cause: error });
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function fetchAnalysisModelCatalog(): Promise<AnalysisModelCatalog> {
  if (STATIC_DEMO_ENABLED) return STATIC_DEMO_ANALYSIS_MODEL_CATALOG;

  const response = await requestWithTimeout(
    '/api/models',
    { method: 'GET' },
    MODEL_CATALOG_REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return AnalysisModelCatalogSchema.parse(await response.json());
}

export async function extractConversation(files: readonly File[]): Promise<ExtractResponse> {
  if (STATIC_DEMO_ENABLED) {
    return {
      extractedText: '',
      requiresManualReview: true,
      notice: '静态演示不会上传或自动识别截图。请在下方手工粘贴聊天文字，并逐句校对说话人。'
    };
  }

  const formData = new FormData();
  files.forEach((file) => formData.append('screenshots', file));

  const response = await requestWithTimeout(
    '/api/extract',
    { method: 'POST', body: formData }
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as ExtractResponse;
}

export async function requestGuidance(input: GuidanceRequest): Promise<GuidanceResponse> {
  if (STATIC_DEMO_ENABLED) {
    const { guideNextConversationDetailed, LocalModelProvider } = await import('@alc/agent-core');
    const conversationInput: ConversationInput = {
      conversationText: input.conversationText,
      relationshipStage: input.relationshipStage,
      goal: input.goal,
      userTone: input.userTone,
      ...(input.context === undefined ? {} : { context: input.context })
    };
    return guideNextConversationDetailed(conversationInput, {
      provider: new LocalModelProvider(),
      fallbackToLocal: false
    });
  }

  const response = await requestWithTimeout(
    '/api/guidance',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const voiceContextToken = readVoiceContextToken(response.headers);
  return {
    guidance: (await response.json()) as GuidanceOutput,
    provenance: readGuidanceProvenance(response.headers),
    ...(voiceContextToken ? { voiceContextToken } : {})
  };
}
