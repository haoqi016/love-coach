import {
  guideNextConversation,
  ModelOutputRejectedError,
  OpenAiCompatibleError,
  OpenAiCompatibleProvider
} from '../packages/agent-core/dist/index.js';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

const provider = new OpenAiCompatibleProvider({
  apiBaseUrl: requiredEnvironment('MODEL_API_BASE_URL'),
  apiKey: requiredEnvironment('MODEL_API_KEY'),
  model: requiredEnvironment('TEXT_MODEL_NAME')
});

const syntheticInput = {
  conversationText: [
    '我：你周末一般会做什么？最近有没有发现好喝的咖啡？',
    '对方：我喜欢周末去找小咖啡店，上次喝到一杯桂花拿铁。',
    '我：听起来不错，我也喜欢咖啡，不过还没试过桂花味。',
    '对方：那家环境挺安静的，我有时候会在那里看书。'
  ].join('\n'),
  relationshipStage: 'getting_to_know',
  goal: 'keep_conversation_flowing',
  userTone: 'warm'
};

const startedAt = performance.now();
try {
  const result = await guideNextConversation(syntheticInput, {
    provider,
    fallbackToLocal: false
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      model: provider.name,
      latencyMs: Math.round(performance.now() - startedAt),
      riskLevel: result.risk.level,
      messageOptionCount: result.messageOptions.length
    })}\n`
  );
} catch (error) {
  const safeError =
    error instanceof OpenAiCompatibleError || error instanceof ModelOutputRejectedError
      ? { ok: false, code: error.code, status: error.status }
      : { ok: false, code: 'unexpected_error' };
  process.stderr.write(`${JSON.stringify(safeError)}\n`);
  process.exitCode = 1;
}
