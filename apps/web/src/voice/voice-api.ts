import {
  GuidanceOutputSchema,
  toGuidanceRequestWithVoiceRefinement,
  VoiceCapabilitiesSchema,
  VoiceContextTokenSchema,
  VoiceEndRequestSchema,
  VoiceRefinementRequestSchema,
  VoiceSessionRequestSchema,
  VoiceSessionResponseSchema,
  VoiceTurnSafetyRequestSchema,
  VoiceTurnSafetyResponseSchema
} from '@alc/contracts';
import type {
  GuidanceOutput,
  GuidanceRequest,
  VoiceCapabilities,
  VoiceContextToken,
  VoiceEndRequest,
  VoiceRefinementRequest,
  VoiceSessionRequest,
  VoiceSessionResponse,
  VoiceTurnSafetyRequest,
  VoiceTurnSafetyResponse
} from '@alc/contracts';
import type { GuidanceProvenance } from '@alc/agent-core';

import {
  BROWSER_REQUEST_TIMEOUT_MS,
  parseError,
  readGuidanceProvenance,
  requestWithTimeout,
  STATIC_DEMO_ENABLED
} from '../api';

const VOICE_CONTROL_REQUEST_TIMEOUT_MS = 12_000;
const VOICE_END_REQUEST_TIMEOUT_MS = 2_500;

export interface VoiceRefinementResponse {
  guidance: GuidanceOutput;
  provenance: GuidanceProvenance | null;
  voiceContextToken: VoiceContextToken | null;
  nextRequest: GuidanceRequest;
}

function readVoiceContextToken(headers: Headers): VoiceContextToken | null {
  const candidate = headers.get('x-alc-voice-context-token')?.trim();
  if (!candidate) return null;
  const parsed = VoiceContextTokenSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

async function postVoiceJson(
  path: string,
  body: unknown,
  timeoutMs = VOICE_CONTROL_REQUEST_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<Response> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  if (signal) init.signal = signal;
  const response = await requestWithTimeout(
    path,
    init,
    timeoutMs
  );
  if (!response.ok) throw new Error(await parseError(response));
  return response;
}

export async function fetchVoiceCapabilities(): Promise<VoiceCapabilities> {
  if (STATIC_DEMO_ENABLED) return { enabled: false };

  const response = await requestWithTimeout(
    '/api/voice/capabilities',
    { method: 'GET' },
    VOICE_CONTROL_REQUEST_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(await parseError(response));
  return VoiceCapabilitiesSchema.parse(await response.json());
}

export async function createVoiceSession(
  input: VoiceSessionRequest
): Promise<VoiceSessionResponse> {
  const request = VoiceSessionRequestSchema.parse(input);
  const response = await postVoiceJson('/api/voice/session', request);
  return VoiceSessionResponseSchema.parse(await response.json());
}

export async function checkVoiceTurnSafety(
  input: VoiceTurnSafetyRequest
): Promise<VoiceTurnSafetyResponse> {
  const request = VoiceTurnSafetyRequestSchema.parse(input);
  const response = await postVoiceJson('/api/voice/turn-safety', request);
  return VoiceTurnSafetyResponseSchema.parse(await response.json());
}

export async function refineGuidanceWithVoice(
  input: VoiceRefinementRequest,
  options: { signal?: AbortSignal } = {}
): Promise<VoiceRefinementResponse> {
  const request = VoiceRefinementRequestSchema.parse(input);
  const response = await postVoiceJson(
    '/api/voice/refine',
    request,
    BROWSER_REQUEST_TIMEOUT_MS,
    options.signal
  );
  return {
    guidance: GuidanceOutputSchema.parse(await response.json()),
    provenance: readGuidanceProvenance(response.headers),
    voiceContextToken: readVoiceContextToken(response.headers),
    nextRequest: toGuidanceRequestWithVoiceRefinement(request)
  };
}

export async function endVoiceSession(
  input: VoiceEndRequest,
  options: { keepalive?: boolean } = {}
): Promise<void> {
  const request = VoiceEndRequestSchema.parse(input);
  const response = await requestWithTimeout(
    '/api/voice/end',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      keepalive: options.keepalive ?? false
    },
    VOICE_END_REQUEST_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(await parseError(response));
}
