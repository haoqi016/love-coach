import {
  InternalConversationInputSchema,
  GuidanceOutputSchema,
  type ConversationInput,
  type GuidanceOutput,
  type RiskAssessment
} from '@alc/contracts';

import { createSafetyGuidance, LocalModelProvider } from './local-provider.js';
import {
  GuidanceRunAbortedError,
  guidanceAbortErrorFromSignal,
  raceWithGuidanceSignal,
  throwIfGuidanceAborted,
  type GuidanceProvenance,
  type GuidanceRunResult,
  type GuideOptions,
  type ModelProviderContext,
  type ModelProvider
} from './model-provider.js';
import { assessInputSafety, modelOutputIsSafe } from './safety.js';
import { buildStrategyProfile } from './strategy-profile.js';

const localProvider = new LocalModelProvider();

export class ModelOutputRejectedError extends Error {
  public readonly code = 'unsafe_model_output' as const;

  public constructor() {
    super('Model provider returned unsafe guidance.');
    this.name = 'ModelOutputRejectedError';
  }
}

interface AbortScope {
  readonly signal: AbortSignal | undefined;
  dispose(): void;
}

function externalAbortScope(signal: AbortSignal | undefined): AbortScope {
  if (signal === undefined) {
    return { signal: undefined, dispose() {} };
  }
  if (signal.aborted) {
    throw new GuidanceRunAbortedError('external_abort');
  }

  const controller = new AbortController();
  const abortFromCaller = (): void => {
    controller.abort(new GuidanceRunAbortedError('external_abort'));
  };
  signal.addEventListener('abort', abortFromCaller, { once: true });
  return {
    signal: controller.signal,
    dispose() {
      signal.removeEventListener('abort', abortFromCaller);
    }
  };
}

function validatedOverallTimeout(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('GuideOptions overallTimeoutMs must be a positive finite number.');
  }
  return value;
}

function remoteAbortScope(
  callerSignal: AbortSignal | undefined,
  overallTimeoutMs: number | undefined
): AbortScope {
  const timeoutMs = validatedOverallTimeout(overallTimeoutMs);
  if (timeoutMs === undefined) {
    return { signal: callerSignal, dispose() {} };
  }

  throwIfGuidanceAborted(callerSignal);
  const controller = new AbortController();
  const abortFromCaller = (): void => {
    if (callerSignal !== undefined) {
      controller.abort(guidanceAbortErrorFromSignal(callerSignal));
    }
  };
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => {
    controller.abort(new GuidanceRunAbortedError('overall_timeout'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  };
}

function providerContext(
  safety: RiskAssessment,
  signal: AbortSignal | undefined
): ModelProviderContext {
  return {
    safety,
    ...(signal === undefined ? {} : { signal })
  };
}

async function providerGuidance(
  provider: ModelProvider,
  input: ConversationInput,
  safety: RiskAssessment,
  signal: AbortSignal | undefined
): Promise<GuidanceOutput> {
  throwIfGuidanceAborted(signal);
  const operation = Promise.resolve().then(() =>
    provider.generateGuidance(input, providerContext(safety, signal))
  );
  const guidance = await raceWithGuidanceSignal(operation, signal);
  throwIfGuidanceAborted(signal);
  return guidance;
}

function riskAssessmentsMatch(
  expected: RiskAssessment,
  actual: RiskAssessment
): boolean {
  if (expected.level !== actual.level || expected.notice !== actual.notice) {
    return false;
  }

  const expectedCategories = new Set(expected.categories);
  const actualCategories = new Set(actual.categories);
  return (
    expectedCategories.size === actualCategories.size &&
    [...expectedCategories].every((category) => actualCategories.has(category))
  );
}

function evidenceQuotesMatchConversation(
  input: ConversationInput,
  guidance: GuidanceOutput
): boolean {
  const evidenceGroups = [
    guidance.summaryEvidence,
    ...guidance.mutualTopicEvidence,
    ...guidance.openLoopEvidence,
    guidance.interactionPattern.evidence,
    ...guidance.topicBridges.map((bridge) => bridge.evidence),
    ...guidance.messageOptions.map((option) => option.evidence),
    guidance.nextStepEvidence
  ];

  return evidenceGroups
    .flat()
    .every(
      (basis) =>
        basis.kind === 'advice' || input.conversationText.includes(basis.quote)
    );
}

function evidenceCoverageMatchesOutput(guidance: GuidanceOutput): boolean {
  const safetyException =
    guidance.risk.level === 'high' || guidance.risk.level === 'crisis';
  const hasQuote = (items: GuidanceOutput['summaryEvidence']): boolean =>
    items.some((basis) => basis.kind === 'quote');

  return (
    guidance.mutualTopics.length === guidance.mutualTopicEvidence.length &&
    guidance.openLoops.length === guidance.openLoopEvidence.length &&
    guidance.mutualTopicEvidence.every(hasQuote) &&
    guidance.openLoopEvidence.every(hasQuote) &&
    (safetyException ||
      (hasQuote(guidance.summaryEvidence) &&
        hasQuote(guidance.interactionPattern.evidence)))
  );
}

function provenance(
  source: GuidanceProvenance['source'],
  provider: ModelProvider | 'deterministic-safety'
): GuidanceProvenance {
  if (provider === 'deterministic-safety') {
    return { source, provider };
  }

  return {
    source,
    provider: provider.name,
    ...(provider.promptVersion ? { promptVersion: provider.promptVersion } : {})
  };
}

function completed(
  guidance: GuidanceOutput,
  runProvenance: GuidanceProvenance
): GuidanceRunResult {
  return { guidance, provenance: runProvenance };
}

function configuredProviders(options: GuideOptions): readonly ModelProvider[] {
  if (options.provider !== undefined && options.providers !== undefined) {
    throw new Error('GuideOptions cannot specify both provider and providers.');
  }
  if (options.providers !== undefined) {
    if (options.providers.length === 0) {
      throw new Error('GuideOptions providers must contain at least one provider.');
    }
    return options.providers;
  }
  return [options.provider ?? localProvider];
}

async function validatedProviderGuidance(
  provider: ModelProvider,
  input: ConversationInput,
  safety: RiskAssessment,
  signal: AbortSignal | undefined
): Promise<GuidanceOutput> {
  const candidate = GuidanceOutputSchema.parse(
    await providerGuidance(provider, input, safety, signal)
  );
  if (!riskAssessmentsMatch(safety, candidate.risk)) {
    throw new Error(
      'Model provider risk assessment does not match the deterministic safety assessment.'
    );
  }
  if (candidate.messageOptions[0]?.style !== input.userTone) {
    throw new Error(
      'Model provider first message option style does not match the requested user tone.'
    );
  }
  if (
    !buildStrategyProfile(input).stagePolicy.allowedDepths.includes(
      candidate.recommendedDepth
    )
  ) {
    throw new Error(
      'Model provider recommended depth does not match the selected relationship stage.'
    );
  }
  if (!evidenceQuotesMatchConversation(input, candidate)) {
    throw new Error(
      'Model provider evidence quote does not match the submitted conversation.'
    );
  }
  if (!evidenceCoverageMatchesOutput(candidate)) {
    throw new Error(
      'Model provider evidence does not cover every submitted guidance judgment.'
    );
  }
  if (!modelOutputIsSafe(candidate)) {
    throw new ModelOutputRejectedError();
  }
  return candidate;
}

function unsafeOutputGuidance(): GuidanceOutput {
  return GuidanceOutputSchema.parse(
    createSafetyGuidance({
      level: 'high',
      categories: ['manipulation'],
      notice: '模型返回了不安全或无法可靠支持的建议，系统已停止展示并改为边界保护提示。'
    })
  );
}

function effectiveAbortError(
  error: unknown,
  callerSignal: AbortSignal | undefined,
  remoteSignal: AbortSignal | undefined
): GuidanceRunAbortedError | undefined {
  if (callerSignal?.aborted) {
    return guidanceAbortErrorFromSignal(callerSignal);
  }
  if (remoteSignal?.aborted) {
    return guidanceAbortErrorFromSignal(remoteSignal);
  }
  return error instanceof GuidanceRunAbortedError ? error : undefined;
}

async function localFallbackResult(
  input: ConversationInput,
  safety: RiskAssessment,
  callerSignal: AbortSignal | undefined
): Promise<GuidanceRunResult> {
  const guidance = GuidanceOutputSchema.parse(
    await providerGuidance(localProvider, input, safety, callerSignal)
  );
  return completed(guidance, provenance('local_fallback', localProvider));
}

export async function guideNextConversationDetailed(
  input: ConversationInput,
  options: GuideOptions = {}
): Promise<GuidanceRunResult> {
  const callerScope = externalAbortScope(options.signal);
  try {
    throwIfGuidanceAborted(callerScope.signal);
    const parsedInput = InternalConversationInputSchema.parse(input);
    const safety = assessInputSafety(parsedInput);
    const publicRisk: RiskAssessment = {
      level: safety.level,
      categories: safety.categories,
      notice: safety.notice
    };

    throwIfGuidanceAborted(callerScope.signal);
    if (safety.blockNormalGuidance) {
      return completed(
        GuidanceOutputSchema.parse(createSafetyGuidance(publicRisk)),
        provenance('local_safety', 'deterministic-safety')
      );
    }

    const providers = configuredProviders(options);
    const remoteScope = remoteAbortScope(
      callerScope.signal,
      options.overallTimeoutMs
    );
    try {
      let lastError: unknown;
      let unsafeOutputError: ModelOutputRejectedError | undefined;
      for (const provider of providers) {
        try {
          const candidate = await validatedProviderGuidance(
            provider,
            parsedInput,
            publicRisk,
            remoteScope.signal
          );
          throwIfGuidanceAborted(remoteScope.signal);
          return completed(
            candidate,
            provenance(
              provider instanceof LocalModelProvider ? 'local' : 'remote',
              provider
            )
          );
        } catch (error: unknown) {
          const abortError = effectiveAbortError(
            error,
            callerScope.signal,
            remoteScope.signal
          );
          if (abortError !== undefined) {
            if (
              abortError.code === 'external_abort' ||
              options.fallbackToLocal === false
            ) {
              throw abortError;
            }
            return await localFallbackResult(
              parsedInput,
              publicRisk,
              callerScope.signal
            );
          }

          lastError = error;
          if (error instanceof ModelOutputRejectedError) {
            unsafeOutputError ??= error;
          }
        }
      }

      const completedAbort = effectiveAbortError(
        undefined,
        callerScope.signal,
        remoteScope.signal
      );
      if (completedAbort !== undefined) {
        if (
          completedAbort.code === 'external_abort' ||
          options.fallbackToLocal === false
        ) {
          throw completedAbort;
        }
        return await localFallbackResult(
          parsedInput,
          publicRisk,
          callerScope.signal
        );
      }

      if (unsafeOutputError) {
        if (options.fallbackToLocal === false) {
          throw unsafeOutputError;
        }
        return completed(
          unsafeOutputGuidance(),
          provenance('local_safety', 'deterministic-safety')
        );
      }
      if (options.fallbackToLocal === false) {
        throw lastError ?? new Error('No model provider completed guidance generation.');
      }
      return await localFallbackResult(
        parsedInput,
        publicRisk,
        callerScope.signal
      );
    } finally {
      remoteScope.dispose();
    }
  } finally {
    callerScope.dispose();
  }
}

export async function guideNextConversation(
  input: ConversationInput,
  options: GuideOptions = {}
): Promise<GuidanceOutput> {
  return (await guideNextConversationDetailed(input, options)).guidance;
}
