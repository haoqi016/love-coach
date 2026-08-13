import {
  EazoAppAiProvider,
  OpenAiCompatibleProvider,
  type GuideOptions,
  type ModelProvider
} from '@alc/agent-core';
import {
  ANALYSIS_MODEL_AUTO_ID,
  AnalysisModelCatalogSchema,
  AnalysisModelIdSchema,
  type AnalysisModelCatalog,
  type AnalysisModelId
} from '@alc/contracts';

import type { ConfiguredAnalysisModel, ServerConfig } from './config.js';
import { RemoteUsageLimitError } from './eazo-usage-guard.js';
import { AppError } from './errors.js';

const SAFE_ERROR_CODE = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u;
const MODEL_NOT_AVAILABLE_MESSAGE = '所选分析模型暂时不可用，请刷新后重新选择。';

export type GuidanceOptionsResolver = (modelId: AnalysisModelId) => GuideOptions;

export interface AnalysisModelRuntime {
  readonly catalog: AnalysisModelCatalog;
  readonly resolveGuideOptions: GuidanceOptionsResolver;
}

export interface CreateAnalysisModelRuntimeOptions {
  readonly config: ServerConfig;
  readonly guidanceProvider?: ModelProvider;
  readonly fetch?: typeof globalThis.fetch;
}

function remoteErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'unknown_error';
  }
  const code = error.code;
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : 'unknown_error';
}

function nestedUsageLimitError(error: unknown): RemoteUsageLimitError | undefined {
  let candidate = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (candidate instanceof RemoteUsageLimitError) return candidate;
    if (typeof candidate !== 'object' || candidate === null || !('cause' in candidate)) {
      return undefined;
    }
    candidate = candidate.cause;
  }
  return undefined;
}

function withSanitizedRemoteLogging(provider: ModelProvider, label: string): ModelProvider {
  return Object.freeze({
    name: provider.name,
    ...(provider.promptVersion ? { promptVersion: provider.promptVersion } : {}),
    async generateGuidance(...args: Parameters<ModelProvider['generateGuidance']>) {
      try {
        return await provider.generateGuidance(...args);
      } catch (error: unknown) {
        const exposedError = nestedUsageLimitError(error) ?? error;
        process.stderr.write(
          `[${label}] guidance_failed code=${remoteErrorCode(exposedError)}\n`
        );
        throw exposedError;
      }
    }
  });
}

function derivedConfiguredModels(config: ServerConfig): readonly ConfiguredAnalysisModel[] {
  if (config.analysisModels !== undefined) return config.analysisModels;

  return [
    ...(config.text
      ? [
          {
            id: AnalysisModelIdSchema.parse('openai-compatible'),
            label: '主办方模型',
            description: '使用比赛模型额度完成关系分析。',
            provider: 'openai-compatible' as const,
            model: config.text.modelName
          }
        ]
      : []),
    ...(config.eazoAppAi
      ? [
          {
            id: AnalysisModelIdSchema.parse('eazo'),
            label: 'Eazo 模型',
            description: '使用 Eazo App AI 完成关系分析。',
            provider: 'eazo' as const,
            model: config.eazoAppAi.textModelKey
          }
        ]
      : [])
  ];
}

function freezeGuideOptions(options: GuideOptions): GuideOptions {
  const providers = options.providers ? Object.freeze([...options.providers]) : undefined;
  return Object.freeze({
    ...options,
    ...(providers ? { providers } : {})
  });
}

export function createAnalysisModelRuntime(
  options: CreateAnalysisModelRuntimeOptions
): AnalysisModelRuntime {
  const { config } = options;
  const configuredModels = options.guidanceProvider ? [] : derivedConfiguredModels(config);
  const providerCache = new Map<string, ModelProvider>();

  const providerFor = (
    providerKind: ConfiguredAnalysisModel['provider'],
    model: string
  ): ModelProvider => {
    const cacheKey = `${providerKind}\u0000${model}`;
    const cached = providerCache.get(cacheKey);
    if (cached) return cached;

    let provider: ModelProvider;
    if (providerKind === 'openai-compatible') {
      const credentials = config.modelApi ?? config.text;
      if (!credentials) {
        throw new Error('OpenAI-compatible analysis model credentials are not configured.');
      }
      provider = new OpenAiCompatibleProvider({
        apiBaseUrl: credentials.apiBaseUrl,
        apiKey: credentials.apiKey,
        model,
        ...(options.fetch ? { fetch: options.fetch } : {})
      });
    } else {
      if (!config.eazoAppAi) {
        throw new Error('Eazo analysis model credentials are not configured.');
      }
      provider = new EazoAppAiProvider({
        apiBaseUrl: config.eazoAppAi.apiBaseUrl,
        appId: config.eazoAppAi.appId,
        privateKey: config.eazoAppAi.privateKey,
        modelKey: model,
        ...(options.fetch ? { fetch: options.fetch } : {})
      });
    }

    const loggedProvider = withSanitizedRemoteLogging(provider, providerKind);
    providerCache.set(cacheKey, loggedProvider);
    return loggedProvider;
  };

  const optionsById = new Map<AnalysisModelId, GuideOptions>();
  let automaticSelectionDescription = '当前使用本地基础整理。';
  if (options.guidanceProvider) {
    optionsById.set(
      ANALYSIS_MODEL_AUTO_ID,
      freezeGuideOptions({
        provider: options.guidanceProvider,
        overallTimeoutMs: config.modelChainTimeoutMs
      })
    );
    automaticSelectionDescription = '使用当前配置的分析模型，失败时使用本地基础整理。';
  } else {
    const automaticProviders: ModelProvider[] = [];
    if (config.text) {
      automaticProviders.push(providerFor('openai-compatible', config.text.modelName));
    }
    if (config.eazoAppAi) {
      automaticProviders.push(providerFor('eazo', config.eazoAppAi.textModelKey));
    }
    if (automaticProviders.length === 0) {
      automaticProviders.push(
        ...configuredModels.map((model) => providerFor(model.provider, model.model))
      );
    }
    optionsById.set(
      ANALYSIS_MODEL_AUTO_ID,
      automaticProviders.length > 0
        ? freezeGuideOptions({
            providers: automaticProviders,
            overallTimeoutMs: config.modelChainTimeoutMs
          })
        : Object.freeze({})
    );
    if (automaticProviders.length > 0) {
      automaticSelectionDescription =
        '按既定顺序尝试可用模型，失败时使用本地基础整理。';
    }

    for (const configuredModel of configuredModels) {
      if (optionsById.has(configuredModel.id)) {
        throw new Error('Analysis model ids must be unique and cannot use auto.');
      }
      optionsById.set(
        configuredModel.id,
        freezeGuideOptions({
          provider: providerFor(configuredModel.provider, configuredModel.model),
          overallTimeoutMs: config.modelChainTimeoutMs
        })
      );
    }
  }

  const catalog = AnalysisModelCatalogSchema.parse({
    defaultModelId: ANALYSIS_MODEL_AUTO_ID,
    models: [
      {
        id: ANALYSIS_MODEL_AUTO_ID,
        label: '自动选择',
        description: automaticSelectionDescription,
        recommended: true
      },
      ...configuredModels.map((model) => ({
        id: model.id,
        label: model.label,
        description: model.description,
        recommended: false
      }))
    ]
  });
  const frozenModels = catalog.models.map((model) => Object.freeze(model));
  Object.freeze(frozenModels);
  const frozenCatalog: AnalysisModelCatalog = {
    ...catalog,
    models: frozenModels
  };
  Object.freeze(frozenCatalog);

  return Object.freeze({
    catalog: frozenCatalog,
    resolveGuideOptions(modelId: AnalysisModelId): GuideOptions {
      const selected = optionsById.get(modelId);
      if (!selected) {
        throw new AppError(
          400,
          'ANALYSIS_MODEL_NOT_AVAILABLE',
          MODEL_NOT_AVAILABLE_MESSAGE
        );
      }
      return selected;
    }
  });
}
