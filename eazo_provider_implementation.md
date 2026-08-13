# Eazo Provider Implementation Report

Status: historical Eazo-only implementation baseline; superseded by the multi-Provider, Prompt v3, and one-minute runtime iterations.

Current behavior is documented in [`README.md`](./README.md) and [`docs/iterations/2026-08-09-full-chat-one-minute.md`](./docs/iterations/2026-08-09-full-chat-one-minute.md). The 45-second and 1,200-token values below describe this earlier baseline and are not the current runtime configuration.

## Implemented

- Added a reusable HTTPS-only Eazo App AI client and a `ModelProvider` for structured text guidance.
- Routed REST and MCP through one provider instance; normal failures fall back to the deterministic local provider.
- Routed screenshot extraction through the same guarded Eazo fetch path with Qwen3-VL, a 45-second timeout, a 1,200-token output cap, and manual-entry fallback.
- Added typed handling for authentication, balance/capability 402, rate limit, upstream, timeout, invalid response, invalid JSON, invalid schema, and local request-budget failures.
- Kept App ID, private key, and model selection server-side. The production Web bundle contains no Eazo server markers.
- Added Railway public-host discovery, concurrent/minute/day usage guards, a combined screenshot upload cap, and sanitized provider-failure logs.
- Enforced deterministic-risk agreement and scanned every user-visible output string for prohibited advice.
- Added a one-call `pnpm test:eazo` synthetic connectivity script with local fallback disabled.

## Changed files

- Project/config: `AGENTS.md`, `.env.example`, `package.json`, `Dockerfile`, `README.md`.
- Core: `packages/agent-core/src/eazo-app-ai-provider.ts`, `guide.ts`, `index.ts`, `safety.ts`.
- Core tests: `packages/agent-core/test/eazo-app-ai-provider.test.ts`, `guide.test.ts`, `safety.test.ts`.
- Server: `apps/server/package.json`, `src/app.ts`, `config.ts`, `eazo-usage-guard.ts`, `image-extractor.ts`, `mcp.ts`.
- Server tests: `apps/server/test/app.test.ts`, `config.test.ts`, `eazo-usage-guard.test.ts`, `image-extractor.test.ts`.
- Web test-only lint fix: `apps/web/src/api.test.ts`.
- Operations/docs: `scripts/eazo-smoke-test.mjs`, `docs/architecture.md`, `task_plan.md`, `notes.md`, `eazo_provider_implementation.md`.

Untouched product surfaces: shared contract source/schema, Web UI and styling, Web API behavior, service worker, lockfile, account/database scope, and realtime voice scope. Build commands refreshed generated `dist` artifacts only.

## Verification

- `pnpm typecheck`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm test`: 64/64 passed (Contracts 2, Agent Core 36, Server 22, Web 4).
- `pnpm build`: passed; Web production bundle is 216.03 kB JavaScript / 69.77 kB gzip.
- Production-dist smoke: Railway-style Host header accepted, `/health` returned `ok`, and local fallback guidance returned three message options.
- Secret scan: no key-like value found; no Eazo server credential/model-client markers found in `apps/web/dist`.
- Real Eazo App AI requests: 1 synthetic text guidance call after the corrected Railway deployment. Screenshot/OCR and MCP paid smoke calls remain unrun. Eazo Creator/build usage for the new draft was previously 81 Credits (80 + 1); the exact post-call model-credit deduction was not shown in the available usage view.
- Final independent review: no P0 blockers. One accepted P1 remains: the daily request counter is process-local, so a restart resets it and multiple replicas multiply it. Keep one Railway replica and auto-recharge disabled for the competition; use durable shared metering before broader public launch.

## Required deployment variables

```text
EAZO_APP_AI_API_BASE=https://eazo.ai/creator
EAZO_APP_ID=<platform-created app id>
EAZO_PRIVATE_KEY=<platform-managed private key>
EAZO_AI_MODELS_JSON={"text":"deepseek.v3.2","vision":"qwen.qwen3-vl-235b-a22b-instruct"}
EAZO_MAX_REQUESTS_PER_MINUTE=60
EAZO_MAX_CONCURRENT_REQUESTS=4
EAZO_MAX_MODEL_REQUESTS_PER_DAY=60
```

## Deployment result

The initial variable-triggered redeploy (`96af2062`) reused the pre-Eazo source image, which explained the deterministic fallback despite correct variables. The current source was then explicitly uploaded as deployment `9f490dd3`; it rebuilt successfully, passed `/health`, and replaced the old image.

One synthetic public guidance call returned HTTP 200 in 12.25 seconds with model-generated content and no sanitized Eazo failure log. The Railway app is now using the configured Eazo text provider. The remaining paid checks are optional screenshot/OCR and MCP smoke tests; keep them deferred unless their paths need competition evidence.
