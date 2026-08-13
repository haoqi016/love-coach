import { z } from 'zod';

import type {
  EazoAppAiProviderOptions,
  OpenAiCompatibleProviderOptions
} from '@alc/agent-core';
import {
  ANALYSIS_MODEL_AUTO_ID,
  AnalysisModelIdSchema,
  VoiceRealtimeModelSchema,
  type AnalysisModelId
} from '@alc/contracts';

const DEFAULT_EAZO_TEXT_MODEL_KEY = 'deepseek.v3.2';
const DEFAULT_EAZO_VISION_MODEL_KEY = 'qwen.qwen3-vl-235b-a22b-instruct';
const DEFAULT_OPENAI_REALTIME_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_REALTIME_MODEL = 'gpt-realtime-2.1-mini';
const DEFAULT_OPENAI_REALTIME_VOICE = 'marin';
const DEFAULT_OPENAI_REALTIME_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

function hasNoControlCharacters(value: string): boolean {
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  });
}

const ModelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(hasNoControlCharacters);

const SecretSchema = z
  .string()
  .max(1_024)
  .refine(hasNoControlCharacters)
  .optional()
  .or(z.literal(''));

const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  MODEL_API_BASE_URL: z.string().url().optional().or(z.literal('')),
  MODEL_API_KEY: z.string().min(1).optional().or(z.literal('')),
  TEXT_MODEL_NAME: ModelNameSchema.optional().or(z.literal('')),
  TEXT_MODEL_OPTIONS_JSON: z.string().max(12_000).optional().or(z.literal('')),
  VISION_MODEL_NAME: ModelNameSchema.optional().or(z.literal('')),
  EAZO_APP_AI_API_BASE: z.string().url().optional().or(z.literal('')),
  EAZO_APP_ID: z.string().min(1).optional().or(z.literal('')),
  EAZO_PRIVATE_KEY: z.string().min(1).optional().or(z.literal('')),
  EAZO_AI_MODELS_JSON: z.string().max(12_000).optional().or(z.literal('')),
  EAZO_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(60),
  EAZO_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(50).default(4),
  EAZO_MAX_MODEL_REQUESTS_PER_DAY: z.coerce.number().int().min(1).max(10_000).default(60),
  MODEL_MAX_REQUESTS_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .or(z.literal('')),
  MODEL_MAX_CONCURRENT_REQUESTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .or(z.literal('')),
  MODEL_MAX_REQUESTS_PER_DAY: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .or(z.literal('')),
  MODEL_CHAIN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(60_000),
  RAILWAY_PUBLIC_DOMAIN: z.string().optional().or(z.literal('')),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(5).default(5),
  MAX_TOTAL_UPLOAD_MB: z.coerce.number().positive().max(15).default(8),
  MAX_SCREENSHOTS: z.coerce.number().int().min(1).max(3).default(3),
  MCP_ALLOWED_HOSTS: z.string().optional().or(z.literal('')),
  VOICE_ENABLED: z.enum(['true', 'false']).default('false'),
  OPENAI_REALTIME_API_BASE: z
    .string()
    .trim()
    .max(2_048)
    .optional()
    .or(z.literal(''))
    .default(DEFAULT_OPENAI_REALTIME_API_BASE),
  OPENAI_REALTIME_API_KEY: SecretSchema,
  OPENAI_REALTIME_MODEL: VoiceRealtimeModelSchema.default(DEFAULT_OPENAI_REALTIME_MODEL),
  OPENAI_REALTIME_VOICE: VoiceRealtimeModelSchema.default(DEFAULT_OPENAI_REALTIME_VOICE),
  OPENAI_REALTIME_TRANSCRIPTION_MODEL: VoiceRealtimeModelSchema.default(
    DEFAULT_OPENAI_REALTIME_TRANSCRIPTION_MODEL
  ),
  VOICE_SESSION_MAX_SECONDS: z.coerce.number().int().min(60).max(300).default(300),
  VOICE_MAX_ACTIVE_LEASES_PER_INSTANCE: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2),
  VOICE_MAX_SESSION_STARTS_PER_DAY: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(30),
  VOICE_CONTEXT_SIGNING_SECRET: SecretSchema
});

const EazoAiModelsSchema = z
  .object({
    text: ModelNameSchema.optional(),
    vision: ModelNameSchema.optional()
  })
  .catchall(z.unknown());

const ConfiguredAnalysisModelSchema = z
  .object({
    id: AnalysisModelIdSchema,
    label: z.string().trim().min(1).max(80).refine(hasNoControlCharacters),
    description: z.string().trim().min(1).max(240).refine(hasNoControlCharacters),
    provider: z.enum(['openai-compatible', 'eazo']),
    model: ModelNameSchema
  })
  .strict();

const ConfiguredAnalysisModelsSchema = z
  .array(ConfiguredAnalysisModelSchema)
  .min(1)
  .max(8)
  .superRefine((models, context) => {
    const ids = new Set<AnalysisModelId>();
    for (const [index, model] of models.entries()) {
      if (model.id === ANALYSIS_MODEL_AUTO_ID) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'auto is reserved'
        });
      }
      if (ids.has(model.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'duplicate analysis model id'
        });
      }
      ids.add(model.id);
    }
  });

export type EazoAppAiServerConfig = Pick<
  EazoAppAiProviderOptions,
  'apiBaseUrl' | 'appId' | 'privateKey'
> & {
  readonly textModelKey: string;
  readonly visionModelKey: string;
  readonly maxRequestsPerMinute: number;
  readonly maxConcurrentRequests: number;
  readonly maxModelRequestsPerDay: number;
};

export type OpenAiCompatibleTextConfig = Pick<
  OpenAiCompatibleProviderOptions,
  'apiBaseUrl' | 'apiKey'
> & {
  readonly modelName: string;
};

export type OpenAiCompatibleCredentials = Pick<
  OpenAiCompatibleProviderOptions,
  'apiBaseUrl' | 'apiKey'
>;

export interface RemoteUsageLimits {
  readonly maxRequestsPerMinute: number;
  readonly maxConcurrentRequests: number;
  readonly maxModelRequestsPerDay: number;
}

export interface RealtimeVoiceServerConfig {
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly transcriptionModel: string;
  readonly maxSessionSeconds: number;
  readonly maxActiveLeasesPerInstance: number;
  readonly maxSessionStartsPerDay: number;
  readonly contextSigningSecret: string;
}

export type AnalysisModelProviderKind = 'openai-compatible' | 'eazo';

export interface ConfiguredAnalysisModel {
  readonly id: AnalysisModelId;
  readonly label: string;
  readonly description: string;
  readonly provider: AnalysisModelProviderKind;
  readonly model: string;
}

export interface ServerConfig {
  port: number;
  allowedOrigins: readonly string[];
  maxUploadBytes: number;
  maxTotalUploadBytes: number;
  maxScreenshots: number;
  mcpAllowedHosts: readonly string[];
  /** End-to-end budget shared by every remote fallback in one inference request. */
  modelChainTimeoutMs: number;
  remoteUsageLimits?: RemoteUsageLimits;
  modelApi?: OpenAiCompatibleCredentials;
  /** Server-only routing metadata. Public clients receive a sanitized catalog. */
  analysisModels?: readonly ConfiguredAnalysisModel[];
  text?: OpenAiCompatibleTextConfig;
  eazoAppAi?: EazoAppAiServerConfig;
  vision?: {
    apiBaseUrl: string;
    apiKey: string;
    modelName: string;
  };
  /** Official OpenAI Realtime credentials and limits. Never serialize this object. */
  realtimeVoice?: RealtimeVoiceServerConfig;
}

function parseRealtimeApiBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid server environment configuration.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error('Invalid server environment configuration.');
  }
  const pathname = parsed.pathname.replace(/\/+$/u, '');
  parsed.pathname = pathname.length > 0 ? pathname : '/v1';
  const normalized = parsed.toString().replace(/\/$/u, '');
  if (normalized !== DEFAULT_OPENAI_REALTIME_API_BASE) {
    throw new Error('Invalid server environment configuration.');
  }
  return normalized;
}

function parseEazoModelKeys(value: string): Pick<EazoAppAiServerConfig, 'textModelKey' | 'visionModelKey'> {
  if (value.trim().length === 0) {
    return {
      textModelKey: DEFAULT_EAZO_TEXT_MODEL_KEY,
      visionModelKey: DEFAULT_EAZO_VISION_MODEL_KEY
    };
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    throw new Error('Invalid server environment configuration.');
  }

  const parsed = EazoAiModelsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error('Invalid server environment configuration.');
  }

  return {
    textModelKey: parsed.data.text ?? DEFAULT_EAZO_TEXT_MODEL_KEY,
    visionModelKey: parsed.data.vision ?? DEFAULT_EAZO_VISION_MODEL_KEY
  };
}

function parseConfiguredAnalysisModels(value: string): readonly ConfiguredAnalysisModel[] | undefined {
  if (value.trim().length === 0) return undefined;

  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    throw new Error('Invalid server environment configuration.');
  }

  const parsed = ConfiguredAnalysisModelsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error('Invalid server environment configuration.');
  }
  return Object.freeze(parsed.data.map((model) => Object.freeze(model)));
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function originHostname(origin: string): string | undefined {
  try {
    return new URL(origin).hostname;
  } catch {
    return undefined;
  }
}

function configuredHostname(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    throw new Error('Invalid server environment configuration.');
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const parsed = EnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error('Invalid server environment configuration.');
  }

  const allowedOrigins = splitCsv(parsed.data.ALLOWED_ORIGINS);
  const configuredHosts = splitCsv(parsed.data.MCP_ALLOWED_HOSTS ?? '');
  const originHosts = allowedOrigins
    .map(originHostname)
    .filter((hostname): hostname is string => hostname !== undefined);
  const railwayPublicHost = configuredHostname(parsed.data.RAILWAY_PUBLIC_DOMAIN ?? '');
  const mcpAllowedHosts = [
    ...new Set([
      'localhost',
      '127.0.0.1',
      '::1',
      ...originHosts,
      ...(railwayPublicHost ? [railwayPublicHost] : []),
      ...configuredHosts
    ])
  ];

  const apiBaseUrl = parsed.data.MODEL_API_BASE_URL;
  const apiKey = parsed.data.MODEL_API_KEY;
  const textModelName = parsed.data.TEXT_MODEL_NAME;
  const modelName = parsed.data.VISION_MODEL_NAME;
  const genericCredentialCount = [apiBaseUrl, apiKey].filter(Boolean).length;
  if (genericCredentialCount === 1 || ((textModelName || modelName) && genericCredentialCount !== 2)) {
    throw new Error('Invalid server environment configuration.');
  }
  const text =
    apiBaseUrl && apiKey && textModelName
      ? {
          apiBaseUrl,
          apiKey,
          modelName: textModelName
        }
      : undefined;
  const modelApi = apiBaseUrl && apiKey ? { apiBaseUrl, apiKey } : undefined;
  const vision =
    apiBaseUrl && apiKey && modelName
      ? {
          apiBaseUrl,
          apiKey,
          modelName
        }
      : undefined;

  const remoteUsageLimits: RemoteUsageLimits = {
    maxRequestsPerMinute:
      parsed.data.MODEL_MAX_REQUESTS_PER_MINUTE || parsed.data.EAZO_MAX_REQUESTS_PER_MINUTE,
    maxConcurrentRequests:
      parsed.data.MODEL_MAX_CONCURRENT_REQUESTS || parsed.data.EAZO_MAX_CONCURRENT_REQUESTS,
    maxModelRequestsPerDay:
      parsed.data.MODEL_MAX_REQUESTS_PER_DAY || parsed.data.EAZO_MAX_MODEL_REQUESTS_PER_DAY
  };

  const eazoApiBaseUrl = parsed.data.EAZO_APP_AI_API_BASE;
  const eazoAppId = parsed.data.EAZO_APP_ID;
  const eazoPrivateKey = parsed.data.EAZO_PRIVATE_KEY;
  const eazoCredentialCount = [eazoApiBaseUrl, eazoAppId, eazoPrivateKey].filter(Boolean).length;
  if (eazoCredentialCount !== 0 && eazoCredentialCount !== 3) {
    throw new Error('Invalid server environment configuration.');
  }

  const eazoAppAi =
    eazoApiBaseUrl && eazoAppId && eazoPrivateKey
      ? {
          apiBaseUrl: eazoApiBaseUrl,
          appId: eazoAppId,
          privateKey: eazoPrivateKey,
          ...parseEazoModelKeys(parsed.data.EAZO_AI_MODELS_JSON ?? ''),
          ...remoteUsageLimits
        }
      : undefined;

  const configuredAnalysisModels = parseConfiguredAnalysisModels(
    parsed.data.TEXT_MODEL_OPTIONS_JSON ?? ''
  );
  if (
    configuredAnalysisModels?.some((model) => model.provider === 'openai-compatible') &&
    !modelApi
  ) {
    throw new Error('Invalid server environment configuration.');
  }
  if (configuredAnalysisModels?.some((model) => model.provider === 'eazo') && !eazoAppAi) {
    throw new Error('Invalid server environment configuration.');
  }

  const analysisModels =
    configuredAnalysisModels ??
    Object.freeze([
      ...(text
        ? [
            Object.freeze({
              id: AnalysisModelIdSchema.parse('openai-compatible'),
              label: '主办方模型',
              description: '使用比赛模型额度完成关系分析。',
              provider: 'openai-compatible' as const,
              model: text.modelName
            })
          ]
        : []),
      ...(eazoAppAi
        ? [
            Object.freeze({
              id: AnalysisModelIdSchema.parse('eazo'),
              label: 'Eazo 模型',
              description: '使用 Eazo App AI 完成关系分析。',
              provider: 'eazo' as const,
              model: eazoAppAi.textModelKey
            })
          ]
        : [])
    ]);

  let realtimeVoice: RealtimeVoiceServerConfig | undefined;
  if (parsed.data.VOICE_ENABLED === 'true') {
    const apiKey = parsed.data.OPENAI_REALTIME_API_KEY?.trim();
    const contextSigningSecret = parsed.data.VOICE_CONTEXT_SIGNING_SECRET?.trim();
    if (!apiKey || !contextSigningSecret || contextSigningSecret.length < 32) {
      throw new Error('Invalid server environment configuration.');
    }
    realtimeVoice = {
      apiBaseUrl: parseRealtimeApiBase(
        parsed.data.OPENAI_REALTIME_API_BASE || DEFAULT_OPENAI_REALTIME_API_BASE
      ),
      apiKey,
      model: parsed.data.OPENAI_REALTIME_MODEL,
      voice: parsed.data.OPENAI_REALTIME_VOICE,
      transcriptionModel: parsed.data.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
      maxSessionSeconds: parsed.data.VOICE_SESSION_MAX_SECONDS,
      maxActiveLeasesPerInstance: parsed.data.VOICE_MAX_ACTIVE_LEASES_PER_INSTANCE,
      maxSessionStartsPerDay: parsed.data.VOICE_MAX_SESSION_STARTS_PER_DAY,
      contextSigningSecret
    };
  }

  return {
    port: parsed.data.PORT,
    allowedOrigins,
    maxUploadBytes: Math.floor(parsed.data.MAX_UPLOAD_MB * 1024 * 1024),
    maxTotalUploadBytes: Math.floor(parsed.data.MAX_TOTAL_UPLOAD_MB * 1024 * 1024),
    maxScreenshots: parsed.data.MAX_SCREENSHOTS,
    mcpAllowedHosts,
    modelChainTimeoutMs: parsed.data.MODEL_CHAIN_TIMEOUT_MS,
    remoteUsageLimits,
    ...(modelApi ? { modelApi } : {}),
    analysisModels,
    ...(text ? { text } : {}),
    ...(eazoAppAi ? { eazoAppAi } : {}),
    ...(vision ? { vision } : {}),
    ...(realtimeVoice ? { realtimeVoice } : {})
  };
}
