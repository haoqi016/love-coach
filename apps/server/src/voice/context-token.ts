import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  TrustedVoiceContextSchema,
  VoiceContextTokenSchema,
  type TrustedVoiceContext,
  type VoiceContextToken
} from '@alc/contracts';
import { z } from 'zod';

const TOKEN_VERSION = 'v1';
const TOKEN_MAX_LENGTH = 4_096;
const SIGNATURE_BYTES = 32;

const VoiceContextTokenPayloadSchema = z
  .object({
    context: TrustedVoiceContextSchema,
    promptVersion: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u),
    exp: z.number().int().positive()
  })
  .strict();

export interface VerifiedVoiceContextToken {
  readonly context: TrustedVoiceContext;
  readonly promptVersion: string;
  readonly exp: number;
}

function truncate(value: string, maximumCodePoints: number): string {
  return [...value].slice(0, maximumCodePoints).join('').trim();
}

/** Keeps the signed header below common proxy header limits without carrying raw chat. */
export function compactTrustedVoiceContext(
  context: TrustedVoiceContext
): TrustedVoiceContext {
  const parsed = TrustedVoiceContextSchema.parse(context);
  return TrustedVoiceContextSchema.parse({
    ...parsed,
    summary: truncate(parsed.summary, 160),
    uncertainties: parsed.uncertainties
      .slice(0, 2)
      .map((uncertainty) => truncate(uncertainty, 70)),
    nextStep: truncate(parsed.nextStep, 140),
    ...(parsed.selectedDraft
      ? { selectedDraft: truncate(parsed.selectedDraft, 120) }
      : {}),
    risk: {
      ...parsed.risk,
      notice: truncate(parsed.risk.notice, 120)
    }
  });
}

export class VoiceContextTokenError extends Error {
  public constructor(public readonly reason: 'invalid' | 'expired') {
    super('The voice context token is invalid or expired.');
    this.name = 'VoiceContextTokenError';
  }
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret)
    .update(`${TOKEN_VERSION}.${encodedPayload}`, 'utf8')
    .digest();
}

export function signVoiceContextToken(
  context: TrustedVoiceContext,
  secret: string,
  promptVersion: string,
  expiresAt: number
): VoiceContextToken {
  const tokenPayload = VoiceContextTokenPayloadSchema.parse({
    context,
    promptVersion,
    exp: expiresAt
  });
  const payload = Buffer.from(JSON.stringify(tokenPayload), 'utf8')
    .toString('base64url');
  const digest = signature(payload, secret).toString('base64url');
  return VoiceContextTokenSchema.parse(`${TOKEN_VERSION}.${payload}.${digest}`);
}

export function verifyVoiceContextToken(
  token: string,
  secret: string,
  now: number = Date.now()
): VerifiedVoiceContextToken {
  if (token.length > TOKEN_MAX_LENGTH) throw new VoiceContextTokenError('invalid');
  const parts = token.split('.');
  const version = parts[0];
  const encodedPayload = parts[1];
  const encodedSignature = parts[2];
  if (
    parts.length !== 3 ||
    version !== TOKEN_VERSION ||
    !encodedPayload ||
    !encodedSignature
  ) {
    throw new VoiceContextTokenError('invalid');
  }

  let receivedSignature: Buffer;
  try {
    receivedSignature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    throw new VoiceContextTokenError('invalid');
  }
  const expectedSignature = signature(encodedPayload, secret);
  if (
    receivedSignature.byteLength !== SIGNATURE_BYTES ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new VoiceContextTokenError('invalid');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new VoiceContextTokenError('invalid');
  }
  const parsed = VoiceContextTokenPayloadSchema.safeParse(candidate);
  if (!parsed.success) throw new VoiceContextTokenError('invalid');
  if (parsed.data.exp * 1_000 <= now) throw new VoiceContextTokenError('expired');
  return parsed.data;
}

export function createAnonymousVoiceClientId(
  secret: string,
  anonymousClientToken: string
): string {
  const digest = createHmac('sha256', secret)
    .update('alc-voice-safety-id\0', 'utf8')
    .update(anonymousClientToken.slice(0, 128), 'utf8')
    .digest('hex');
  return `alc_${digest.slice(0, 48)}`;
}
