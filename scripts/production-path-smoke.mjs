import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { GuidanceOutputSchema } from '../packages/contracts/dist/index.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const manifestPath = join(repositoryRoot, 'evals', 'v1', 'production-smoke.json');
const reportJsonPath = join(repositoryRoot, 'evals', 'reports', 'production-smoke-latest.json');
const reportMarkdownPath = join(repositoryRoot, 'evals', 'reports', 'production-smoke-latest.md');
// The server gives one remote Provider chain at most 60 seconds. Keep only a
// small transport allowance so the smoke client can receive the fallback or
// error produced at that deadline without extending model processing.
const requestTimeoutMs = 70_000;
const mcpClientEntry = join(
  repositoryRoot,
  'apps',
  'server',
  'node_modules',
  '@modelcontextprotocol',
  'client',
  'dist',
  'index.mjs'
);

function argumentsMap(argv) {
  return new Map(
    argv.map((argument) => {
      const separator = argument.indexOf('=');
      return separator < 0
        ? [argument, true]
        : [argument.slice(0, separator), argument.slice(separator + 1)];
    })
  );
}

function normalizedBaseUrl(rawValue) {
  const url = new URL(rawValue);
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('Base URL must use HTTPS, except for localhost smoke tests.');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url;
}

function endpoint(baseUrl, pathname) {
  const result = new URL(baseUrl);
  result.pathname = `${result.pathname}/${pathname}`.replace(/\/{2,}/gu, '/');
  return result;
}

async function jsonResponse(response, label) {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return body;
}

function provenanceHeaders(response) {
  return {
    requestId: response.headers.get('x-request-id'),
    source: response.headers.get('x-alc-guidance-source'),
    provider: response.headers.get('x-alc-guidance-provider'),
    promptVersion: response.headers.get('x-alc-prompt-version')
  };
}

function evidenceFailures(guidance, conversationText) {
  const failures = [];
  if (guidance.mutualTopicEvidence.length !== guidance.mutualTopics.length) {
    failures.push('mutualTopicEvidence length does not match mutualTopics');
  }
  if (guidance.openLoopEvidence.length !== guidance.openLoops.length) {
    failures.push('openLoopEvidence length does not match openLoops');
  }
  const groups = [
    ['summaryEvidence', guidance.summaryEvidence],
    ...guidance.mutualTopicEvidence.map((evidence, index) => [`mutualTopicEvidence[${index}]`, evidence]),
    ...guidance.openLoopEvidence.map((evidence, index) => [`openLoopEvidence[${index}]`, evidence]),
    ['interactionPattern.evidence', guidance.interactionPattern.evidence],
    ...guidance.topicBridges.map((bridge, index) => [`topicBridges[${index}].evidence`, bridge.evidence]),
    ...guidance.messageOptions.map((option, index) => [`messageOptions[${index}].evidence`, option.evidence]),
    ['nextStepEvidence', guidance.nextStepEvidence]
  ];
  for (const [path, evidence] of groups) {
    if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 3) {
      failures.push(`${path} must contain 1-3 evidence items`);
      continue;
    }
    for (const basis of evidence) {
      if (basis.kind === 'quote' && !conversationText.includes(basis.quote)) {
        failures.push(`${path} contains a quote that is not an exact input substring`);
      }
    }
  }
  return failures;
}

function assertRemoteProvenance(provenance, label) {
  if (
    provenance === null ||
    typeof provenance !== 'object' ||
    provenance.source !== 'remote' ||
    typeof provenance.provider !== 'string' ||
    provenance.provider.trim().length === 0 ||
    provenance.promptVersion !== 'guidance-v4'
  ) {
    throw new Error(`${label} did not prove remote guidance-v4 provenance.`);
  }
}

async function runText(baseUrl, input) {
  const response = await fetch(endpoint(baseUrl, 'api/guidance'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const body = await jsonResponse(response, 'REST text');
  const guidance = GuidanceOutputSchema.parse(body);
  const provenance = provenanceHeaders(response);
  if (typeof provenance.requestId !== 'string' || provenance.requestId.length === 0) {
    throw new Error('REST text response is missing x-request-id.');
  }
  assertRemoteProvenance(provenance, 'REST text');
  const failures = evidenceFailures(guidance, input.conversationText);
  if (failures.length > 0) {
    throw new Error(`REST text evidence failed: ${failures.join('; ')}`);
  }
  return { path: 'text', passed: true, status: response.status, provenance };
}

async function runScreenshot(baseUrl, screenshotPath, expectedFragments, expectedLineCount) {
  const extension = extname(screenshotPath).toLowerCase();
  const mimeType = extension === '.png'
    ? 'image/png'
    : ['.jpg', '.jpeg'].includes(extension)
      ? 'image/jpeg'
      : undefined;
  if (mimeType === undefined) {
    throw new Error('Screenshot must be a PNG or JPEG file.');
  }
  const bytes = await readFile(screenshotPath);
  const form = new FormData();
  form.append('screenshots', new Blob([bytes], { type: mimeType }), `synthetic-chat${extension}`);
  const response = await fetch(endpoint(baseUrl, 'api/extract'), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const body = await jsonResponse(response, 'REST screenshot');
  if (body === null || typeof body !== 'object' || typeof body.extractedText !== 'string') {
    throw new Error('Screenshot response is missing extractedText.');
  }
  const lines = body.extractedText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    lines.length !== expectedLineCount ||
    lines.some((line) => !/^(?:我|对方)[：:]\s*\S/u.test(line))
  ) {
    throw new Error(`Screenshot OCR must return exactly ${expectedLineCount} non-empty 我/对方 labeled lines.`);
  }
  if (body.extractedText.includes('[无法辨认]')) {
    throw new Error('Screenshot OCR contains an unreadable marker.');
  }
  if (body.requiresManualReview !== true) {
    throw new Error('Screenshot OCR must require manual review before guidance.');
  }
  if (typeof body.notice !== 'string' || body.notice.trim().length === 0) {
    throw new Error('Screenshot OCR response is missing its review notice.');
  }
  const missingFragments = expectedFragments.filter((fragment) => !body.extractedText.includes(fragment));
  if (missingFragments.length > 0) {
    throw new Error(`Screenshot OCR missed expected fragments: ${missingFragments.join(', ')}`);
  }
  const requestId = response.headers.get('x-request-id');
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('Screenshot response is missing x-request-id.');
  }
  return {
    path: 'screenshot',
    passed: true,
    status: response.status,
    requestId,
    extractedCharacters: body.extractedText.length,
    labeledLines: lines.length,
    requiresManualReview: true,
    expectedFragmentsMatched: expectedFragments.length,
    notice: body.notice
  };
}

async function runMcp(baseUrl, toolName, input, mcpClientModule) {
  const { Client, StreamableHTTPClientTransport } = mcpClientModule;
  const client = new Client({ name: 'alc-production-smoke', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint(baseUrl, 'mcp')),
    { timeout: requestTimeoutMs }
  );
  try {
    const tools = await client.listTools(undefined, { timeout: requestTimeoutMs });
    if (tools.tools.length !== 1 || tools.tools[0]?.name !== toolName) {
      throw new Error(`MCP must list exactly one tool named ${toolName}.`);
    }
    const result = await client.callTool(
      { name: toolName, arguments: input },
      { timeout: requestTimeoutMs }
    );
    if (result.isError === true) {
      throw new Error('MCP guidance tool returned an error result.');
    }
    const guidance = GuidanceOutputSchema.parse(result.structuredContent);
    const provenance = result._meta?.['com.alittlecloser/provenance'];
    assertRemoteProvenance(provenance, 'MCP');
    const failures = evidenceFailures(guidance, input.conversationText);
    if (failures.length > 0) {
      throw new Error(`MCP evidence failed: ${failures.join('; ')}`);
    }
    if (result.content.length !== 1 || result.content[0]?.type !== 'text') {
      throw new Error('MCP content must contain exactly one text JSON result.');
    }
    const contentGuidance = JSON.parse(result.content[0].text);
    if (!isDeepStrictEqual(contentGuidance, result.structuredContent)) {
      throw new Error('MCP text content does not deep-equal structuredContent.');
    }
    return {
      path: 'mcp',
      passed: true,
      toolListed: true,
      structuredOutputValid: true,
      provenance
    };
  } finally {
    await client.close();
  }
}

function markdownReport(report) {
  const lines = [
    '# Production path smoke report',
    '',
    `- Base URL: \`${report.baseUrl}\``,
    `- Planned inference calls: **${report.plannedInferenceCalls}**`,
    `- Executed inference calls: **${report.executedInferenceCalls}**`,
    `- Overall: **${report.passed ? 'PASS' : 'FAIL'}**`,
    '',
    '| Path | Result | Details |',
    '|---|---:|---|'
  ];
  for (const result of report.results) {
    const details = [
      `${result.durationMs} ms`,
      result.provenance?.provider ? `provider=${result.provenance.provider}` : undefined,
      result.provenance?.promptVersion ? `prompt=${result.provenance.promptVersion}` : undefined,
      result.provenance?.requestId ? `requestId=${result.provenance.requestId}` : undefined,
      result.requestId ? `requestId=${result.requestId}` : undefined,
      result.error ?? (result.passed ? 'schema and path checks passed' : undefined)
    ]
      .filter((value) => typeof value === 'string')
      .join('; ')
      .replaceAll('|', '\\|');
    lines.push(`| ${result.path} | ${result.passed ? 'PASS' : 'FAIL'} | ${details} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = argumentsMap(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const requestedPaths = String(options.get('--paths') ?? manifest.paths.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedPaths = new Set(manifest.paths);
  if (requestedPaths.some((path) => !allowedPaths.has(path))) {
    throw new Error(`--paths must contain only: ${manifest.paths.join(', ')}`);
  }
  if (requestedPaths.length === 0 || new Set(requestedPaths).size !== requestedPaths.length) {
    throw new Error('--paths must contain one or more unique paths.');
  }

  const baseUrlValue = options.get('--base-url');
  const confirmed = options.get('--confirm-remote') === 'RUN';
  if (!confirmed || typeof baseUrlValue !== 'string') {
    process.stdout.write(
      [
        'DRY RUN ONLY: no network requests were made.',
        `Planned paths: ${requestedPaths.join(', ')}`,
        `Planned inference requests: ${requestedPaths.length}`,
        'To execute, provide --base-url=https://... --confirm-remote=RUN.',
        'Screenshot path also requires --screenshot=C:\\path\\to\\synthetic-chat.png.'
      ].join('\n') + '\n'
    );
    return;
  }

  const baseUrl = normalizedBaseUrl(baseUrlValue);
  const screenshotOption = options.get('--screenshot');
  if (requestedPaths.includes('screenshot') && typeof screenshotOption !== 'string') {
    throw new Error('The screenshot path is required before any production calls are made.');
  }
  const screenshotPath = typeof screenshotOption === 'string'
    ? resolve(screenshotOption)
    : undefined;
  if (screenshotPath !== undefined) {
    const extension = extname(screenshotPath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) {
      throw new Error('Screenshot must be a PNG or JPEG file.');
    }
    const bytes = await readFile(screenshotPath);
    const validPng = extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const validJpeg = ['.jpg', '.jpeg'].includes(extension) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!validPng && !validJpeg) {
      throw new Error('Screenshot file signature does not match its extension.');
    }
  }
  const mcpClientModule = requestedPaths.includes('mcp')
    ? await (async () => {
        await access(mcpClientEntry);
        return import(pathToFileURL(mcpClientEntry).href);
      })()
    : undefined;

  const fixturePath = join(repositoryRoot, 'evals', 'v1', manifest.textFixture);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const results = [];
  let executedInferenceCalls = 0;

  for (const path of requestedPaths) {
    const startedAt = Date.now();
    try {
      let result;
      if (path === 'text') {
        executedInferenceCalls += 1;
        result = await runText(baseUrl, fixture.input);
      } else if (path === 'screenshot') {
        executedInferenceCalls += 1;
        result = await runScreenshot(
          baseUrl,
          screenshotPath,
          manifest.screenshot.expectedTextFragments,
          manifest.screenshot.expectedLineCount
        );
      } else {
        executedInferenceCalls += 1;
        result = await runMcp(baseUrl, manifest.mcpTool, fixture.input, mcpClientModule);
      }
      results.push({ ...result, durationMs: Date.now() - startedAt });
    } catch (error) {
      results.push({
        path,
        passed: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      break;
    }
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: baseUrl.origin,
    plannedInferenceCalls: requestedPaths.length,
    executedInferenceCalls,
    passed: results.every((result) => result.passed),
    results
  };
  await mkdir(dirname(reportJsonPath), { recursive: true });
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(reportMarkdownPath, markdownReport(report), 'utf8');
  process.stdout.write(`Production smoke: ${report.passed ? 'PASS' : 'FAIL'} (${executedInferenceCalls} inference requests).\n`);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

await main();
