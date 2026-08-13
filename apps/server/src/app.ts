import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  assessVoiceTurnSafety,
  buildVoiceCoachInstructions,
  createTrustedVoiceContext,
  GUIDANCE_PROMPT_VERSION,
  guideNextConversationDetailed,
  voiceCoachOutputIsSafe,
  voiceTurnTextIsSafe,
  type GuideOptions,
  type GuidanceProvenance,
  type ModelProvider
} from '@alc/agent-core';
import {
  GuidanceOutputSchema,
  GuidanceRequestSchema,
  MAX_VOICE_TURN_TEXT_LENGTH,
  TrustedVoiceContextSchema,
  toGuidanceRequestWithVoiceRefinement,
  VoiceCapabilitiesSchema,
  VoiceEndRequestSchema,
  VoiceRefinementRequestSchema,
  VOICE_REFINEMENT_INTERNAL_END_SENTINEL,
  VOICE_REFINEMENT_INTERNAL_START_SENTINEL,
  VoiceSessionRequestSchema,
  VoiceSessionResponseSchema,
  VoiceTurnSafetyRequestSchema,
  VoiceTurnSafetyResponseSchema,
  type GuidanceRequest,
  type VoiceTurnSafetyRequest,
  type VoiceTurnSafetyResponse
} from '@alc/contracts';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import cors from 'cors';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';

import { createAnalysisModelRuntime } from './analysis-models.js';
import type { ServerConfig } from './config.js';
import { loadConfig } from './config.js';
import { RemoteUsageGuard, RemoteUsageLimitError } from './eazo-usage-guard.js';
import { AppError, errorHandler, notFoundHandler } from './errors.js';
import {
  createImageTextExtractor,
  hasValidImageSignature,
  type ImageTextExtractor,
  SUPPORTED_IMAGE_TYPES,
  type SupportedImageType
} from './image-extractor.js';
import { createGuidanceMcpHandler } from './mcp.js';
import type { PublicInferenceRunner } from './mcp.js';
import { requestIdMiddleware } from './request-id.js';
import {
  compactTrustedVoiceContext,
  createAnonymousVoiceClientId,
  signVoiceContextToken,
  verifyVoiceContextToken,
  VoiceContextTokenError
} from './voice/context-token.js';
import { VoiceLeaseManager } from './voice/lease-manager.js';
import { OpenAiRealtimeClient, RealtimeClientError } from './voice/realtime-client.js';

const WEB_DIST_PATH = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const REMOTE_BUSY_MESSAGE = 'The public AI demo is temporarily busy. Please try again shortly.';
const GUIDANCE_SOURCE_HEADER = 'X-ALC-Guidance-Source';
const GUIDANCE_PROVIDER_HEADER = 'X-ALC-Guidance-Provider';
const PROMPT_VERSION_HEADER = 'X-ALC-Prompt-Version';
const VOICE_CONTEXT_TOKEN_HEADER = 'X-ALC-Voice-Context-Token';
const VOICE_CONTEXT_TOKEN_TTL_SECONDS = 10 * 60;
const VOICE_REFINEMENT_UNAVAILABLE_MESSAGE =
  'Voice refinement could not update the guidance. The previous result is unchanged.';
const VOICE_CLIENT_COOKIE_NAME = 'alc_voice_client';
const VOICE_CLIENT_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const SAFE_VOICE_CLIENT_TOKEN = /^[A-Za-z0-9_-]{32,128}$/u;
const SAFE_PROVENANCE_METADATA = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u;
const VOICE_REFINEMENT_NOTE_LINE =
  /^- (?:历史补充|本轮补充|历史更正|本轮更正)·(?:目标|感受|担忧|边界|语气偏好|其他补充)：(.+)$/u;
const VOICE_REFINEMENT_SELECTED_DRAFT_LINE = /^- 用户选中的旧草稿：(.+)$/u;
const VOICE_TURN_SAFETY_WINDOW_STEP = Math.floor(
  MAX_VOICE_TURN_TEXT_LENGTH / 2
);
const CUMULATIVE_VOICE_SAFETY_NOTICE =
  '连续多轮语音内容触发了安全限制，实时语音会话已停止。';
const DEFAULT_REMOTE_USAGE_LIMITS = {
  maxRequestsPerMinute: 60,
  maxConcurrentRequests: 4,
  maxModelRequestsPerDay: 60
} as const;

function combinedVoiceRefinementSafetyText(context: string): string | undefined {
  const normalized = context.trim();
  const startIndex = normalized.indexOf(
    VOICE_REFINEMENT_INTERNAL_START_SENTINEL
  );
  const endIndex = normalized.indexOf(
    VOICE_REFINEMENT_INTERNAL_END_SENTINEL,
    startIndex
  );
  if (
    startIndex < 0 ||
    endIndex < startIndex ||
    endIndex + VOICE_REFINEMENT_INTERNAL_END_SENTINEL.length !==
      normalized.length
  ) {
    return undefined;
  }

  const baseContext = normalized.slice(0, startIndex).trim();
  const values: string[] = [];
  const block = normalized.slice(startIndex, endIndex);
  for (const line of block.split(/\r?\n/u)) {
    const noteMatch = VOICE_REFINEMENT_NOTE_LINE.exec(line);
    if (noteMatch?.[1] !== undefined) {
      values.push(noteMatch[1]);
      continue;
    }
    const draftMatch = VOICE_REFINEMENT_SELECTED_DRAFT_LINE.exec(line);
    if (draftMatch?.[1] !== undefined) values.push(draftMatch[1]);
  }
  if (values.length < 2) return undefined;
  return `${baseContext}${values.join('')}`;
}

function assessCumulativeVoiceTurnSafety(
  turn: VoiceTurnSafetyRequest,
  approvedTranscriptSuffix: string
): VoiceTurnSafetyResponse | undefined {
  const cumulativeTranscript = `${approvedTranscriptSuffix}${turn.transcript}`;
  if (voiceTurnTextIsSafe(cumulativeTranscript)) return undefined;

  for (
    let start = 0;
    start < cumulativeTranscript.length;
    start += VOICE_TURN_SAFETY_WINDOW_STEP
  ) {
    const transcript = cumulativeTranscript.slice(
      start,
      start + MAX_VOICE_TURN_TEXT_LENGTH
    );
    const safety = VoiceTurnSafetyResponseSchema.parse(
      assessVoiceTurnSafety({ ...turn, transcript })
    );
    if (safety.action === 'safety_stop') return safety;
    if (start + MAX_VOICE_TURN_TEXT_LENGTH >= cumulativeTranscript.length) {
      break;
    }
  }

  return VoiceTurnSafetyResponseSchema.parse({
    action: 'safety_stop',
    reason: 'high_risk',
    risk: {
      level: 'high',
      categories: [],
      notice: CUMULATIVE_VOICE_SAFETY_NOTICE
    },
    responseText: CUMULATIVE_VOICE_SAFETY_NOTICE
  });
}

export interface CreateAppOptions {
  config?: ServerConfig;
  guidanceProvider?: ModelProvider;
  imageTextExtractor?: ImageTextExtractor;
  realtimeFetch?: typeof fetch;
  voiceNow?: () => number;
  voiceClientSecretTimeoutMilliseconds?: number;
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

function isSameOriginHost(origin: string, request: Request): boolean {
  try {
    const host = request.headers.host;
    if (!host) return false;
    const originUrl = new URL(origin);
    const requestUrl = new URL(`${originUrl.protocol}//${host}`);
    return originUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

function safeProvenanceMetadata(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && SAFE_PROVENANCE_METADATA.test(trimmed) ? trimmed : undefined;
}

function setGuidanceProvenanceHeaders(
  response: Response,
  provenance: GuidanceProvenance
): void {
  response.setHeader(GUIDANCE_SOURCE_HEADER, provenance.source);
  const provider = safeProvenanceMetadata(provenance.provider);
  const promptVersion = safeProvenanceMetadata(provenance.promptVersion);
  if (provider) response.setHeader(GUIDANCE_PROVIDER_HEADER, provider);
  if (promptVersion) response.setHeader(PROMPT_VERSION_HEADER, promptVersion);
}

function publicRealtimeModelLabel(model: string): string {
  if (model === 'gpt-realtime-2.1-mini') return 'GPT Realtime 2.1 Mini';
  if (model === 'gpt-realtime-2.1') return 'GPT Realtime 2.1';
  return 'Realtime Voice Model';
}

function publicRealtimeVoiceLabel(voice: string): string {
  const publicNames: Readonly<Record<string, string>> = {
    alloy: 'Alloy',
    ash: 'Ash',
    ballad: 'Ballad',
    coral: 'Coral',
    echo: 'Echo',
    marin: 'Marin',
    sage: 'Sage',
    shimmer: 'Shimmer',
    verse: 'Verse'
  };
  return publicNames[voice] ?? 'Realtime Voice';
}

export function createApp(options: CreateAppOptions = {}) {
  const config = options.config ?? loadConfig();
  const voiceNow = options.voiceNow ?? Date.now;
  const hasConfiguredRemote = Boolean(
    config.text || config.vision || config.eazoAppAi || config.analysisModels?.length
  );
  const remoteUsageLimits =
    config.remoteUsageLimits ??
    (config.eazoAppAi
      ? {
          maxRequestsPerMinute: config.eazoAppAi.maxRequestsPerMinute,
          maxConcurrentRequests: config.eazoAppAi.maxConcurrentRequests,
          maxModelRequestsPerDay: config.eazoAppAi.maxModelRequestsPerDay
        }
      : DEFAULT_REMOTE_USAGE_LIMITS);
  const remoteUsageGuard = hasConfiguredRemote
    ? new RemoteUsageGuard(remoteUsageLimits)
    : undefined;
  const analysisModelRuntime = createAnalysisModelRuntime({
    config,
    ...(options.guidanceProvider ? { guidanceProvider: options.guidanceProvider } : {}),
    ...(remoteUsageGuard ? { fetch: remoteUsageGuard.guardedFetch } : {})
  });
  const extractor =
    options.imageTextExtractor ??
    createImageTextExtractor(config, remoteUsageGuard?.guardedFetch);
  const realtimeClient = config.realtimeVoice
    ? new OpenAiRealtimeClient(config.realtimeVoice, {
        ...(options.realtimeFetch ? { fetch: options.realtimeFetch } : {}),
        ...(options.voiceClientSecretTimeoutMilliseconds
          ? { timeoutMilliseconds: options.voiceClientSecretTimeoutMilliseconds }
          : {}),
        now: voiceNow
      })
    : undefined;
  const voiceLeaseManager = config.realtimeVoice
    ? new VoiceLeaseManager({
        maxActiveLeases: config.realtimeVoice.maxActiveLeasesPerInstance,
        maxStartsPerDay: config.realtimeVoice.maxSessionStartsPerDay,
        maxSessionSeconds: config.realtimeVoice.maxSessionSeconds,
        now: voiceNow
      })
    : undefined;
  const voiceModelLabel = config.realtimeVoice
    ? publicRealtimeModelLabel(config.realtimeVoice.model)
    : undefined;
  const voiceLabel = config.realtimeVoice
    ? publicRealtimeVoiceLabel(config.realtimeVoice.voice)
    : undefined;
  const runMcpPublicInference: PublicInferenceRunner = async (operation) => {
    if (!remoteUsageGuard) return operation();
    const permit = remoteUsageGuard.beginPublicRequest();
    if (!permit.allowed) {
      throw new RemoteUsageLimitError('rate_limited', REMOTE_BUSY_MESSAGE, 429);
    }
    try {
      return await operation();
    } finally {
      permit.release();
    }
  };
  const acquireRoutePermit: RequestHandler = (_request, response, next) => {
    if (!remoteUsageGuard) {
      next();
      return;
    }

    const permit = remoteUsageGuard.beginPublicRequest();
    if (!permit.allowed) {
      response.setHeader('Retry-After', String(permit.retryAfterSeconds));
      next(new AppError(429, 'REMOTE_RATE_LIMITED', REMOTE_BUSY_MESSAGE));
      return;
    }

    response.locals.remoteInferenceStarted = false;
    response.locals.remotePermitRelease = permit.release;
    const releaseIfIdle = () => {
      if (response.locals.remoteInferenceStarted !== true) permit.release();
    };
    response.once('finish', releaseIfIdle);
    response.once('close', releaseIfIdle);
    next();
  };
  const validateGuidanceSelection: RequestHandler = (request, response, next) => {
    try {
      const guidanceRequest = GuidanceRequestSchema.parse(request.body);
      const guideOptions = analysisModelRuntime.resolveGuideOptions(
        guidanceRequest.analysisModelId
      );
      response.locals.guidanceRequest = guidanceRequest;
      response.locals.guideOptions = guideOptions;
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
  const runRouteInference = async <T>(
    request: Request,
    response: Response,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    response.locals.remoteInferenceStarted = true;
    const controller = new AbortController();
    const abortIfDisconnected = () => {
      if (!response.writableEnded && !controller.signal.aborted) {
        controller.abort(new DOMException('The client disconnected.', 'AbortError'));
      }
    };
    request.once('aborted', abortIfDisconnected);
    response.once('close', abortIfDisconnected);
    if (request.aborted || response.destroyed) {
      abortIfDisconnected();
    }
    try {
      return await operation(controller.signal);
    } finally {
      request.off('aborted', abortIfDisconnected);
      response.off('close', abortIfDisconnected);
      const release = response.locals.remotePermitRelease as (() => void) | undefined;
      release?.();
    }
  };
  const anonymousVoiceClientId = (request: Request, response: Response): string => {
    if (!config.realtimeVoice) return '';
    const cookieHeader = request.get('cookie') ?? '';
    const existingToken = cookieHeader
      .split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${VOICE_CLIENT_COOKIE_NAME}=`))
      ?.slice(VOICE_CLIENT_COOKIE_NAME.length + 1);
    const anonymousClientToken =
      existingToken && SAFE_VOICE_CLIENT_TOKEN.test(existingToken)
        ? existingToken
        : randomBytes(32).toString('base64url');
    if (anonymousClientToken !== existingToken) {
      const forwardedProtocol = request.get('x-forwarded-proto')
        ?.split(',')[0]
        ?.trim()
        .toLowerCase();
      response.cookie(VOICE_CLIENT_COOKIE_NAME, anonymousClientToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: request.secure || forwardedProtocol === 'https',
        path: '/',
        maxAge: VOICE_CLIENT_COOKIE_MAX_AGE_MS
      });
    }
    return createAnonymousVoiceClientId(
      config.realtimeVoice.contextSigningSecret,
      anonymousClientToken
    );
  };
  const setVoiceContextTokenHeader = (
    response: Response,
    guidanceRequest: GuidanceRequest,
    output: ReturnType<typeof GuidanceOutputSchema.parse>,
    provenance: GuidanceProvenance
  ): void => {
    if (!config.realtimeVoice) return;
    if (output.risk.level === 'high' || output.risk.level === 'crisis') return;
    try {
      const context = compactTrustedVoiceContext(
        createTrustedVoiceContext(guidanceRequest, output)
      );
      if (context.risk.level === 'high' || context.risk.level === 'crisis') return;
      const promptVersion =
        safeProvenanceMetadata(provenance.promptVersion) ?? GUIDANCE_PROMPT_VERSION;
      const token = signVoiceContextToken(
        context,
        config.realtimeVoice.contextSigningSecret,
        promptVersion,
        Math.floor(voiceNow() / 1_000) + VOICE_CONTEXT_TOKEN_TTL_SECONDS
      );
      response.setHeader(VOICE_CONTEXT_TOKEN_HEADER, token);
      response.setHeader('Cache-Control', 'no-store');
    } catch {
      // Voice is optional. Token compaction/signing must never break text guidance.
    }
  };
  const requireVoiceFeature: RequestHandler = (_request, _response, next) => {
    if (!config.realtimeVoice) {
      next(new AppError(404, 'VOICE_NOT_AVAILABLE', 'Realtime voice is not available.'));
      return;
    }
    next();
  };
  const app = createMcpExpressApp({
    host: '0.0.0.0',
    allowedHosts: [...config.mcpAllowedHosts],
    jsonLimit: '512kb'
  });

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: [
            "'self'",
            ...(config.realtimeVoice
              ? [new URL(config.realtimeVoice.apiBaseUrl).origin]
              : [])
          ]
        }
      }
    })
  );
  app.use((_request, response, next) => {
    response.setHeader('Permissions-Policy', 'microphone=(self)');
    next();
  });
  app.use(requestIdMiddleware);
  const allowedCrossOriginCors = cors({
    origin: true,
    exposedHeaders: [
      'x-request-id',
      GUIDANCE_SOURCE_HEADER,
      GUIDANCE_PROVIDER_HEADER,
      PROMPT_VERSION_HEADER,
      VOICE_CONTEXT_TOKEN_HEADER
    ]
  });
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (!origin || isSameOriginHost(origin, request)) {
      next();
      return;
    }
    if (config.allowedOrigins.includes(origin)) {
      allowedCrossOriginCors(request, response, next);
      return;
    }
    next(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.'));
  });

  // createMcpExpressApp parses JSON before routes. Forward that parsed body so
  // the Node adapter does not try to read an already-consumed request stream.
  const mcpHandler = toNodeHandler(
    createGuidanceMcpHandler(
      analysisModelRuntime.resolveGuideOptions,
      runMcpPublicInference
    )
  );
  app.all('/mcp', (request, response, next) => {
    void mcpHandler(request, response, request.body).catch(next);
  });

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: '@alc/server' });
  });

  app.get('/api/models', (_request, response) => {
    response.json(analysisModelRuntime.catalog);
  });

  app.post(
    '/api/guidance',
    validateGuidanceSelection,
    acquireRoutePermit,
    asyncRoute(async (request, response) => {
      const { analysisModelId, ...input } = response.locals.guidanceRequest as GuidanceRequest;
      void analysisModelId;
      const guideOptions = response.locals.guideOptions as GuideOptions;
      const result = await runRouteInference(request, response, (signal) =>
        guideNextConversationDetailed(input, { ...guideOptions, signal })
      );
      const output = GuidanceOutputSchema.parse(result.guidance);
      setGuidanceProvenanceHeaders(response, result.provenance);
      setVoiceContextTokenHeader(
        response,
        response.locals.guidanceRequest as GuidanceRequest,
        output,
        result.provenance
      );
      response.json(output);
    })
  );

  app.get('/api/voice/capabilities', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      VoiceCapabilitiesSchema.parse(
        config.realtimeVoice && voiceModelLabel && voiceLabel
          ? {
              enabled: true,
              modelLabel: voiceModelLabel,
              voiceLabel,
              maxSessionSeconds: config.realtimeVoice.maxSessionSeconds
            }
          : { enabled: false }
      )
    );
  });

  app.post(
    '/api/voice/session',
    asyncRoute(async (request, response) => {
      if (
        !config.realtimeVoice ||
        !realtimeClient ||
        !voiceLeaseManager ||
        !voiceModelLabel ||
        !voiceLabel
      ) {
        throw new AppError(404, 'VOICE_NOT_AVAILABLE', 'Realtime voice is not available.');
      }
      response.setHeader('Cache-Control', 'no-store');
      const sessionRequest = VoiceSessionRequestSchema.parse(request.body);
      let verifiedContext: ReturnType<typeof verifyVoiceContextToken>;
      try {
        verifiedContext = verifyVoiceContextToken(
          sessionRequest.voiceContextToken,
          config.realtimeVoice.contextSigningSecret,
          voiceNow()
        );
      } catch (error: unknown) {
        if (error instanceof VoiceContextTokenError) {
          throw new AppError(
            400,
            'INVALID_VOICE_CONTEXT',
            'The voice context token is invalid or expired.'
          );
        }
        throw error;
      }
      if (
        !voiceCoachOutputIsSafe(sessionRequest.selectedDraft) ||
        !voiceTurnTextIsSafe(sessionRequest.selectedDraft)
      ) {
        throw new AppError(
          400,
          'UNSAFE_VOICE_DRAFT',
          'The selected draft cannot be used for realtime voice coaching.'
        );
      }
      const sessionContext = TrustedVoiceContextSchema.parse({
        ...verifiedContext.context,
        selectedDraft: sessionRequest.selectedDraft
      });
      const clientId = anonymousVoiceClientId(request, response);
      const leaseResult = voiceLeaseManager.begin(clientId);
      if (!leaseResult.allowed) {
        response.setHeader('Retry-After', String(leaseResult.retryAfterSeconds));
        throw new AppError(
          429,
          'VOICE_SESSION_LIMITED',
          'Realtime voice is temporarily busy. Please try again later.'
        );
      }

      try {
        const sessionInstructions = buildVoiceCoachInstructions(sessionContext);
        const secret = await runRouteInference(request, response, (signal) =>
          realtimeClient.createClientSecret({
            instructions: sessionInstructions,
            safetyIdentifier: clientId,
            signal
          })
        );
        if (secret.expiresAt <= Math.floor(voiceNow() / 1_000)) {
          throw new RealtimeClientError('invalid_response');
        }
        response.json(
          VoiceSessionResponseSchema.parse({
            clientSecret: secret.value,
            expiresAt: secret.expiresAt,
            sessionLeaseId: leaseResult.lease.id,
            model: config.realtimeVoice.model,
            transcriptionModel: config.realtimeVoice.transcriptionModel,
            voice: config.realtimeVoice.voice,
            sessionInstructions,
            modelLabel: voiceModelLabel,
            voiceLabel,
            maxSessionSeconds: config.realtimeVoice.maxSessionSeconds
          })
        );
      } catch (error: unknown) {
        voiceLeaseManager.releaseAfterFailedStart(leaseResult.lease.id, clientId);
        if (error instanceof RealtimeClientError) {
          throw new AppError(
            error.reason === 'aborted' ? 499 : 503,
            error.reason === 'aborted'
              ? 'VOICE_SESSION_CANCELLED'
              : 'VOICE_UPSTREAM_UNAVAILABLE',
            error.reason === 'aborted'
              ? 'The voice session request was cancelled.'
              : 'Realtime voice is temporarily unavailable.'
          );
        }
        throw error;
      }
    })
  );

  app.post('/api/voice/turn-safety', (request, response, next) => {
    try {
      if (!config.realtimeVoice || !voiceLeaseManager) {
        throw new AppError(404, 'VOICE_NOT_AVAILABLE', 'Realtime voice is not available.');
      }
      response.setHeader('Cache-Control', 'no-store');
      const turn = VoiceTurnSafetyRequestSchema.parse(request.body);
      const clientId = anonymousVoiceClientId(request, response);
      const approvedTranscriptSuffix =
        voiceLeaseManager.approvedTranscriptSuffix(
          turn.sessionLeaseId,
          clientId
        );
      if (approvedTranscriptSuffix === undefined) {
        throw new AppError(
          409,
          'VOICE_SESSION_INACTIVE',
          'The realtime voice session is no longer active.'
        );
      }
      let safety = VoiceTurnSafetyResponseSchema.parse(
        assessVoiceTurnSafety(turn)
      );
      if (safety.action === 'allow') {
        safety =
          assessCumulativeVoiceTurnSafety(turn, approvedTranscriptSuffix) ??
          safety;
      }
      if (safety.action === 'safety_stop') {
        voiceLeaseManager.end(turn.sessionLeaseId, clientId);
      } else if (
        !voiceLeaseManager.recordApprovedTranscript(
          turn.sessionLeaseId,
          clientId,
          turn.transcript
        )
      ) {
        throw new AppError(
          409,
          'VOICE_SESSION_INACTIVE',
          'The realtime voice session is no longer active.'
        );
      }
      response.json(safety);
    } catch (error: unknown) {
      next(error);
    }
  });

  app.post('/api/voice/end', (request, response, next) => {
    try {
      if (!config.realtimeVoice || !voiceLeaseManager) {
        throw new AppError(404, 'VOICE_NOT_AVAILABLE', 'Realtime voice is not available.');
      }
      response.setHeader('Cache-Control', 'no-store');
      const endRequest = VoiceEndRequestSchema.parse(request.body);
      voiceLeaseManager.end(
        endRequest.sessionLeaseId,
        anonymousVoiceClientId(request, response)
      );
      response.sendStatus(204);
    } catch (error: unknown) {
      next(error);
    }
  });

  const validateVoiceRefinement: RequestHandler = (request, response, next) => {
    try {
      const refinementRequest = VoiceRefinementRequestSchema.parse(request.body);
      if (
        !voiceCoachOutputIsSafe(refinementRequest.selectedDraft) ||
        !voiceTurnTextIsSafe(refinementRequest.selectedDraft)
      ) {
        throw new AppError(
          400,
          'UNSAFE_VOICE_DRAFT',
          'The selected draft cannot be used for voice refinement.'
        );
      }
      if (
        refinementRequest.notes.some(
          (note) => !voiceTurnTextIsSafe(note.value)
        ) ||
        !voiceTurnTextIsSafe(
          refinementRequest.notes.map((note) => note.value).join('')
        )
      ) {
        throw new AppError(
          400,
          'UNSAFE_VOICE_NOTE',
          'A voice refinement note cannot be used for ordinary relationship guidance.'
        );
      }
      const guidanceRequest = toGuidanceRequestWithVoiceRefinement(refinementRequest);
      const mergedContext = guidanceRequest.context ?? '';
      const combinedSafetyText = combinedVoiceRefinementSafetyText(mergedContext);
      if (
        !voiceTurnTextIsSafe(mergedContext) ||
        combinedSafetyText === undefined ||
        !voiceTurnTextIsSafe(combinedSafetyText)
      ) {
        throw new AppError(
          400,
          'UNSAFE_VOICE_CONTEXT',
          'The merged voice refinement context cannot be used for ordinary relationship guidance.'
        );
      }
      response.locals.guidanceRequest = guidanceRequest;
      response.locals.guideOptions = analysisModelRuntime.resolveGuideOptions(
        guidanceRequest.analysisModelId
      );
      next();
    } catch (error: unknown) {
      next(error);
    }
  };

  app.post(
    '/api/voice/refine',
    requireVoiceFeature,
    validateVoiceRefinement,
    acquireRoutePermit,
    asyncRoute(async (request, response) => {
      const guidanceRequest = response.locals.guidanceRequest as GuidanceRequest;
      const { analysisModelId, ...input } = guidanceRequest;
      void analysisModelId;
      const guideOptions = response.locals.guideOptions as GuideOptions;
      const hasConfiguredRefinementProvider =
        guideOptions.provider !== undefined ||
        (guideOptions.providers?.length ?? 0) > 0;
      if (!hasConfiguredRefinementProvider) {
        throw new AppError(
          503,
          'VOICE_REFINEMENT_UNAVAILABLE',
          VOICE_REFINEMENT_UNAVAILABLE_MESSAGE
        );
      }
      let result: Awaited<ReturnType<typeof guideNextConversationDetailed>>;
      try {
        result = await runRouteInference(request, response, (signal) =>
          guideNextConversationDetailed(input, {
            ...guideOptions,
            fallbackToLocal: false,
            signal
          })
        );
      } catch {
        throw new AppError(
          503,
          'VOICE_REFINEMENT_UNAVAILABLE',
          VOICE_REFINEMENT_UNAVAILABLE_MESSAGE
        );
      }
      if (
        result.provenance.source !== 'remote' &&
        result.provenance.source !== 'local_safety'
      ) {
        throw new AppError(
          503,
          'VOICE_REFINEMENT_UNAVAILABLE',
          VOICE_REFINEMENT_UNAVAILABLE_MESSAGE
        );
      }
      const output = GuidanceOutputSchema.parse(result.guidance);
      setGuidanceProvenanceHeaders(response, result.provenance);
      setVoiceContextTokenHeader(response, guidanceRequest, output, result.provenance);
      response.json(output);
    })
  );

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: config.maxScreenshots,
      fileSize: config.maxUploadBytes
    },
    fileFilter(_request, file, callback) {
      if ((SUPPORTED_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) {
        callback(null, true);
        return;
      }
      callback(new AppError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Only JPG and PNG screenshots are accepted.'));
    }
  });

  app.post(
    '/api/extract',
    acquireRoutePermit,
    upload.array('screenshots', config.maxScreenshots),
    asyncRoute(async (request, response) => {
      const files = request.files;
      if (!Array.isArray(files) || files.length < 1 || files.length > config.maxScreenshots) {
        throw new AppError(400, 'INVALID_SCREENSHOT_COUNT', 'Upload between one and three screenshots.');
      }
      const totalUploadBytes = files.reduce((total, file) => total + file.size, 0);
      if (totalUploadBytes > config.maxTotalUploadBytes) {
        throw new AppError(
          413,
          'IMAGES_TOO_LARGE',
          'The combined screenshot upload is too large.'
        );
      }

      const images = files.map((file) => {
        const mimeType = file.mimetype as SupportedImageType;
        if (!hasValidImageSignature(file.buffer, mimeType)) {
          throw new AppError(415, 'INVALID_IMAGE', 'A screenshot does not contain valid JPG or PNG data.');
        }
        return { bytes: file.buffer, mimeType };
      });

      response.json(
        await runRouteInference(request, response, (signal) =>
          extractor.extract(images, { signal })
        )
      );
    })
  );

  if (existsSync(WEB_DIST_PATH)) {
    app.use(express.static(WEB_DIST_PATH, { index: false, fallthrough: true }));
    app.use((request, response, next) => {
      const acceptsHtml = request.method === 'GET' && request.accepts('html');
      const isServiceRoute = request.path.startsWith('/api/') || request.path === '/mcp';
      if (acceptsHtml && !isServiceRoute) {
        response.sendFile('index.html', { root: WEB_DIST_PATH });
        return;
      }
      next();
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
