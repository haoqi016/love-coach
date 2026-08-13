import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LocalModelProvider,
  guideNextConversationDetailed,
  modelOutputIsSafe
} from '../packages/agent-core/dist/index.js';
import {
  ConversationInputSchema,
  GuidanceOutputSchema
} from '../packages/contracts/dist/index.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const casesDirectory = join(repositoryRoot, 'evals', 'v1', 'cases');
const reportDirectory = join(repositoryRoot, 'evals', 'reports');
const provider = new LocalModelProvider();

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function generatedTextValues(guidance) {
  return [
    guidance.summary,
    ...guidance.mutualTopics,
    ...guidance.openLoops,
    guidance.interactionPattern.observation,
    ...guidance.uncertainties,
    ...guidance.topicBridges.flatMap((bridge) => [bridge.from, bridge.to, bridge.prompt]),
    ...guidance.messageOptions.flatMap((option) => [option.text, option.why, option.watchFor]),
    guidance.risk.notice,
    guidance.nextStep
  ];
}

function sameMembers(actual, expected) {
  return (
    actual.length === expected.length &&
    expected.every((item) => actual.includes(item))
  );
}

function assertFixtureShape(fixture, filename) {
  if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new Error(`${filename}: fixture must be a JSON object.`);
  }
  for (const key of ['id', 'description', 'input', 'expectations']) {
    if (!(key in fixture)) {
      throw new Error(`${filename}: missing ${key}.`);
    }
  }
  if (typeof fixture.id !== 'string' || !/^[a-z0-9-]+$/u.test(fixture.id)) {
    throw new Error(`${filename}: id must use lowercase letters, numbers, and hyphens.`);
  }
  if (!Array.isArray(fixture.tags) || fixture.tags.length === 0) {
    throw new Error(`${filename}: tags must be a non-empty array.`);
  }
}

async function loadFixtures() {
  const filenames = (await readdir(casesDirectory))
    .filter((filename) => filename.endsWith('.json'))
    .sort();
  if (filenames.length < 12) {
    throw new Error(`Expected at least 12 fixtures, found ${filenames.length}.`);
  }

  const fixtures = [];
  const ids = new Set();
  for (const filename of filenames) {
    const fixture = JSON.parse(
      await readFile(join(casesDirectory, filename), 'utf8')
    );
    assertFixtureShape(fixture, filename);
    if (ids.has(fixture.id)) {
      throw new Error(`${filename}: duplicate fixture id ${fixture.id}.`);
    }
    ids.add(fixture.id);
    fixtures.push({ ...fixture, filename });
  }
  return fixtures;
}

function evidenceEntries(guidance) {
  return [
    { path: 'summary', evidence: guidance.summaryEvidence },
    ...guidance.mutualTopics.map((_topic, index) => ({
      path: `mutualTopics[${index}]`,
      evidence: guidance.mutualTopicEvidence[index]
    })),
    ...guidance.openLoops.map((_loop, index) => ({
      path: `openLoops[${index}]`,
      evidence: guidance.openLoopEvidence[index]
    })),
    {
      path: 'interactionPattern',
      evidence: guidance.interactionPattern.evidence
    },
    ...guidance.topicBridges.map((bridge, index) => ({
      path: `topicBridges[${index}]`,
      evidence: bridge.evidence
    })),
    ...guidance.messageOptions.map((option, index) => ({
      path: `messageOptions[${index}]`,
      evidence: option.evidence
    })),
    { path: 'nextStep', evidence: guidance.nextStepEvidence }
  ];
}

function checkEvidence(guidance, conversationText) {
  const failures = [];
  let quoteCount = 0;
  let adviceCount = 0;
  const entries = evidenceEntries(guidance);

  for (const entry of entries) {
    if (!Array.isArray(entry.evidence)) {
      failures.push(`${entry.path}.evidence is missing or is not an array`);
      continue;
    }
    if (entry.evidence.length < 1 || entry.evidence.length > 3) {
      failures.push(`${entry.path}.evidence must contain 1-3 items`);
    }
    for (const [index, basis] of entry.evidence.entries()) {
      const basisPath = `${entry.path}.evidence[${index}]`;
      if (basis === null || typeof basis !== 'object' || Array.isArray(basis)) {
        failures.push(`${basisPath} must be an object`);
        continue;
      }
      if (basis.kind === 'quote') {
        quoteCount += 1;
        const keys = Object.keys(basis).sort();
        if (keys.join(',') !== 'kind,quote') {
          failures.push(`${basisPath} quote basis has unexpected keys`);
        }
        if (
          typeof basis.quote !== 'string' ||
          basis.quote.trim().length === 0 ||
          basis.quote.length > 120
        ) {
          failures.push(`${basisPath}.quote must contain 1-120 characters`);
        } else if (!conversationText.includes(basis.quote)) {
          failures.push(`${basisPath}.quote is not an exact input substring`);
        }
      } else if (basis.kind === 'advice') {
        adviceCount += 1;
        if (Object.keys(basis).join(',') !== 'kind') {
          failures.push(`${basisPath} advice basis has unexpected keys`);
        }
      } else {
        failures.push(`${basisPath}.kind must be quote or advice`);
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
    quoteCount,
    adviceCount,
    claimCount: entries.length
  };
}

function evaluateExpectations(fixture, firstRun, secondRun) {
  const checks = [];
  const add = (name, passed, detail) => {
    checks.push({ name, passed, ...(passed || detail === undefined ? {} : { detail }) });
  };
  const inputResult = ConversationInputSchema.safeParse(fixture.input);
  add(
    'input-schema',
    inputResult.success,
    inputResult.success ? undefined : inputResult.error.message
  );

  const outputResult = GuidanceOutputSchema.safeParse(firstRun.guidance);
  add(
    'output-schema',
    outputResult.success,
    outputResult.success ? undefined : outputResult.error.message
  );
  if (!outputResult.success) {
    return { checks, evidence: { quoteCount: 0, adviceCount: 0, claimCount: 0 } };
  }

  const guidance = outputResult.data;
  const expected = fixture.expectations;
  const allText = generatedTextValues(guidance).join('\n');
  const evidence = checkEvidence(guidance, fixture.input.conversationText);

  add('repeatability', stableJson(firstRun) === stableJson(secondRun), 'two local runs differ');
  add('safe-output-filter', modelOutputIsSafe(guidance), 'output contains prohibited advice');
  add('risk-level', guidance.risk.level === expected.risk.level, `expected ${expected.risk.level}, got ${guidance.risk.level}`);
  add(
    'risk-categories',
    sameMembers(guidance.risk.categories, expected.risk.categories),
    `expected ${expected.risk.categories.join(',') || 'none'}, got ${guidance.risk.categories.join(',') || 'none'}`
  );
  add('provenance-source', firstRun.provenance.source === expected.provenance.source, `expected ${expected.provenance.source}, got ${firstRun.provenance.source}`);
  add('provenance-provider', firstRun.provenance.provider === expected.provenance.provider, `expected ${expected.provenance.provider}, got ${firstRun.provenance.provider}`);
  add('recommended-depth', guidance.recommendedDepth === expected.recommendedDepth, `expected ${expected.recommendedDepth}, got ${guidance.recommendedDepth}`);
  add('reciprocity', guidance.interactionPattern.reciprocity === expected.interactionPattern.reciprocity, `expected ${expected.interactionPattern.reciprocity}, got ${guidance.interactionPattern.reciprocity}`);
  add('pacing', guidance.interactionPattern.pacing === expected.interactionPattern.pacing, `expected ${expected.interactionPattern.pacing}, got ${guidance.interactionPattern.pacing}`);

  const expectedFirstStyle = expected.messageOptions.firstStyle === 'input'
    ? fixture.input.userTone
    : expected.messageOptions.firstStyle;
  add('target-tone', guidance.messageOptions[0]?.style === expectedFirstStyle, `expected ${expectedFirstStyle}, got ${guidance.messageOptions[0]?.style ?? 'missing'}`);
  add('message-option-count', guidance.messageOptions.length >= expected.messageOptions.min && guidance.messageOptions.length <= expected.messageOptions.max, `expected ${expected.messageOptions.min}-${expected.messageOptions.max}, got ${guidance.messageOptions.length}`);
  add('minimum-uncertainties', guidance.uncertainties.length >= expected.minimumUncertainties, `expected at least ${expected.minimumUncertainties}, got ${guidance.uncertainties.length}`);
  add('guidance-block-state', (firstRun.provenance.source === 'local_safety') === expected.normalGuidanceBlocked, `expected blocked=${expected.normalGuidanceBlocked}`);
  add('mutual-topic-evidence-alignment', guidance.mutualTopicEvidence.length === guidance.mutualTopics.length, `expected ${guidance.mutualTopics.length}, got ${guidance.mutualTopicEvidence.length}`);
  add('open-loop-evidence-alignment', guidance.openLoopEvidence.length === guidance.openLoops.length, `expected ${guidance.openLoops.length}, got ${guidance.openLoopEvidence.length}`);

  if (expected.topicBridgeCount !== undefined) {
    add('topic-bridge-count', guidance.topicBridges.length >= expected.topicBridgeCount.min && guidance.topicBridges.length <= expected.topicBridgeCount.max, `expected ${expected.topicBridgeCount.min}-${expected.topicBridgeCount.max}, got ${guidance.topicBridges.length}`);
  }
  for (const topic of expected.mutualTopicsInclude ?? []) {
    add(`mutual-topic:${topic}`, guidance.mutualTopics.includes(topic), `missing mutual topic ${topic}`);
  }
  for (const text of expected.outputContainsAll ?? []) {
    add(`output-contains:${text}`, allText.includes(text), `output does not contain ${text}`);
  }
  if (Array.isArray(expected.outputContainsAny)) {
    add('output-contains-any', expected.outputContainsAny.some((text) => allText.includes(text)), `output contains none of: ${expected.outputContainsAny.join(', ')}`);
  }

  add('evidence-coverage-and-source', evidence.passed, evidence.failures.join('; '));
  add('minimum-quote-count', evidence.quoteCount >= expected.evidence.minimumQuoteCount, `expected at least ${expected.evidence.minimumQuoteCount}, got ${evidence.quoteCount}`);

  return { checks, evidence };
}

function markdownReport(report) {
  const lines = [
    '# Fixed evaluation report',
    '',
    `- Suite: \`${report.suiteVersion}\``,
    `- Mode: \`${report.mode}\``,
    `- Remote call attempts: **${report.remoteCallAttempts}**`,
    `- Cases: **${report.summary.passed}/${report.summary.total} passed**`,
    `- Checks: **${report.summary.checksPassed}/${report.summary.checksTotal} passed**`,
    '',
    '| Case | Result | Risk | Tone | Evidence quotes | Digest |',
    '|---|---:|---|---|---:|---|'
  ];
  for (const result of report.cases) {
    lines.push(
      `| ${result.id} | ${result.passed ? 'PASS' : 'FAIL'} | ${result.riskLevel} | ${result.firstMessageTone} | ${result.evidence.quoteCount} | \`${result.guidanceSha256.slice(0, 12)}\` |`
    );
  }
  const failedChecks = report.cases.flatMap((result) =>
    result.checks
      .filter((check) => !check.passed)
      .map((check) => `- \`${result.id}\` / \`${check.name}\`: ${check.detail ?? 'failed'}`)
  );
  lines.push('', '## Failures', '');
  lines.push(...(failedChecks.length === 0 ? ['None.'] : failedChecks));
  lines.push('', '## Coverage', '');
  lines.push(`- Tags: ${report.coverage.tags.map((tag) => `\`${tag}\``).join(', ')}`);
  lines.push(`- Risk levels: ${report.coverage.riskLevels.map((level) => `\`${level}\``).join(', ')}`);
  lines.push(`- Requested tones: ${report.coverage.requestedTones.map((tone) => `\`${tone}\``).join(', ')}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const fixtures = await loadFixtures();
  const originalFetch = globalThis.fetch;
  let remoteCallAttempts = 0;
  globalThis.fetch = async () => {
    remoteCallAttempts += 1;
    throw new Error('Fixed eval forbids remote fetch.');
  };

  const cases = [];
  try {
    for (const fixture of fixtures) {
      try {
        const firstRun = await guideNextConversationDetailed(fixture.input, {
          provider,
          fallbackToLocal: false
        });
        const secondRun = await guideNextConversationDetailed(fixture.input, {
          provider,
          fallbackToLocal: false
        });
        const evaluation = evaluateExpectations(fixture, firstRun, secondRun);
        cases.push({
          id: fixture.id,
          filename: fixture.filename,
          tags: fixture.tags,
          passed: evaluation.checks.every((check) => check.passed),
          riskLevel: firstRun.guidance.risk.level,
          firstMessageTone: firstRun.guidance.messageOptions[0]?.style ?? 'missing',
          guidanceSha256: digest(firstRun.guidance),
          evidence: {
            quoteCount: evaluation.evidence.quoteCount,
            adviceCount: evaluation.evidence.adviceCount,
            claimCount: evaluation.evidence.claimCount
          },
          checks: evaluation.checks
        });
      } catch (error) {
        cases.push({
          id: fixture.id,
          filename: fixture.filename,
          tags: fixture.tags,
          passed: false,
          riskLevel: 'unavailable',
          firstMessageTone: 'unavailable',
          guidanceSha256: digest({ id: fixture.id, status: 'generation-failed' }),
          evidence: { quoteCount: 0, adviceCount: 0, claimCount: 0 },
          checks: [
            {
              name: 'guidance-generation',
              passed: false,
              detail: error instanceof Error ? error.message : String(error)
            }
          ]
        });
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  const checks = cases.flatMap((result) => result.checks);
  const report = {
    schemaVersion: 1,
    suiteVersion: 'v1',
    mode: 'local-deterministic-no-network',
    remoteCallAttempts,
    summary: {
      total: cases.length,
      passed: cases.filter((result) => result.passed).length,
      failed: cases.filter((result) => !result.passed).length,
      checksTotal: checks.length,
      checksPassed: checks.filter((check) => check.passed).length,
      checksFailed: checks.filter((check) => !check.passed).length
    },
    coverage: {
      tags: [...new Set(cases.flatMap((result) => result.tags))].sort(),
      riskLevels: [...new Set(cases.map((result) => result.riskLevel))].sort(),
      requestedTones: [...new Set(fixtures.map((fixture) => fixture.input.userTone))].sort()
    },
    cases
  };

  await mkdir(reportDirectory, { recursive: true });
  await writeFile(join(reportDirectory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(reportDirectory, 'latest.md'), markdownReport(report), 'utf8');

  process.stdout.write(
    `Fixed eval: ${report.summary.passed}/${report.summary.total} cases, ` +
      `${report.summary.checksPassed}/${report.summary.checksTotal} checks, ` +
      `${remoteCallAttempts} remote calls.\n`
  );
  if (report.summary.failed > 0 || remoteCallAttempts > 0) {
    process.exitCode = 1;
  }
}

await main();
