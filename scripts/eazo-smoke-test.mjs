import {
  EazoAppAiError,
  EazoAppAiProvider,
  guideNextConversation
} from '../packages/agent-core/dist/index.js';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function textModelKey() {
  const raw = process.env.EAZO_AI_MODELS_JSON?.trim();
  if (!raw) return 'deepseek.v3.2';
  const parsed = JSON.parse(raw);
  if (typeof parsed?.text !== 'string' || parsed.text.trim().length === 0) {
    throw new Error('EAZO_AI_MODELS_JSON does not contain a text model key.');
  }
  return parsed.text.trim();
}

const provider = new EazoAppAiProvider({
  apiBaseUrl: requiredEnvironment('EAZO_APP_AI_API_BASE'),
  appId: requiredEnvironment('EAZO_APP_ID'),
  privateKey: requiredEnvironment('EAZO_PRIVATE_KEY'),
  modelKey: textModelKey()
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
    error instanceof EazoAppAiError
      ? { ok: false, code: error.code, status: error.status }
      : { ok: false, code: 'unexpected_error' };
  process.stderr.write(`${JSON.stringify(safeError)}\n`);
  process.exitCode = 1;
}
