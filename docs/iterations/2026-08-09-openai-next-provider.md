# Iteration: Temporary OpenAI-Compatible Event Provider

Status: Complete locally; not deployed to Railway

## Goal

Use the organizer-issued multi-model API allocation for bounded competition testing and the final demo without removing the existing Eazo and deterministic fallbacks.

## Baseline

- Text guidance uses Eazo App AI when configured and otherwise falls back to the deterministic local Provider.
- Screenshot extraction contains an OpenAI-compatible adapter, but Eazo takes precedence whenever Eazo is configured.
- The existing text Provider is specific to the Eazo App AI proxy.
- Public rate, concurrency, and daily-attempt protection is named and instantiated around the Eazo configuration.

## Verified Event Gateway Facts

- Event portal: `https://credits.openai-next.com/zh/events/eazo-global-youth-ai-agent-hackathon-2026`.
- API base: `https://api.openai-next.com/v1` for OpenAI-compatible clients.
- Authentication: server-side `Authorization: Bearer <API key>`.
- The account displayed USD 500 total, USD 0 consumed, USD 0 allocated, and USD 500 available before any key was created.
- The event page displayed expiry `2026-08-11 00:00` without a timezone.
- Up to three capped API keys can be created. Disabling a key returns its unconsumed allocation after settlement.
- Failed authentication, rejected-over-limit requests, and network failures are documented as non-billable; successful upstream requests are billed at upstream official prices.
- The checked guide did not document data-retention terms or explicitly guarantee multimodal `image_url` compatibility for every listed vision model.

## Decision

- Add a generic OpenAI-compatible text Provider using the same versioned Prompt v2 and output contract as Eazo.
- Allow an ordered Provider list so provenance identifies the actual Provider that succeeded.
- Use the runtime order `OpenAI-compatible -> Eazo -> deterministic local` when both remote configurations are complete.
- Use the screenshot order `OpenAI-compatible vision -> Eazo vision -> manual entry` when both vision configurations are complete.
- Apply the same public request and model-attempt guard to every remote Provider.
- Keep all gateway values in server environment variables and keep the gateway hostname configurable.

## Acceptance Criteria

- No real API request or credential is needed for local tests.
- Text and screenshot calls use HTTPS and never expose the Bearer key to the browser, response, logs, or provenance.
- A failed or invalid primary response tries the next configured remote Provider; all-remote failure retains the local/manual path.
- The returned guidance continues to pass deterministic risk, tone, schema, and output-safety checks.
- REST and MCP use the same ordered Provider configuration.
- Provenance identifies the Provider that actually returned the accepted result.
- Existing Eazo-only and no-remote configurations remain compatible.
- Dynamic users must explicitly consent before either screenshot extraction or final text analysis can send data to a third party; static mode must not claim an upload.
- One text request uses an 18-second code default; Railway production overrides this to 30 seconds after the full structured response exceeded 18 seconds. A disconnected client stops immediately and never starts the next Provider.
- Generic vision fixes output at 1200 tokens with streaming disabled; generic and Eazo attempts are limited to 8 seconds each before manual fallback.

## Files Changed

Agent Core and shared prompt:

- `packages/agent-core/src/guidance-prompt.ts`
- `packages/agent-core/src/guidance-json.ts`
- `packages/agent-core/src/openai-compatible-provider.ts`
- `packages/agent-core/src/eazo-app-ai-provider.ts`
- `packages/agent-core/src/model-provider.ts`
- `packages/agent-core/src/guide.ts`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/test/openai-compatible-provider.test.ts`
- `packages/agent-core/test/guide.test.ts`

Server configuration, usage protection, screenshot chain, and tests:

- `.env.example`
- `apps/server/src/config.ts`
- `apps/server/src/app.ts`
- `apps/server/src/eazo-usage-guard.ts`
- `apps/server/src/image-extractor.ts`
- `apps/server/src/index.ts`
- `apps/server/test/config.test.ts`
- `apps/server/test/app.test.ts`
- `apps/server/test/eazo-usage-guard.test.ts`
- `apps/server/test/image-extractor.test.ts`

User-facing provenance and controlled connectivity tooling:

- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/styles.css`
- `scripts/model-smoke-test.mjs`
- `package.json`

Durable project records:

- `AGENTS.md`
- `README.md`
- `CHANGELOG.md`
- `notes.md`
- `task_plan.md`
- `docs/iterations/2026-08-09-openai-next-provider.md`

## Verification

- `pnpm lint`: passed across Contracts, Agent Core, Server, and Web.
- `pnpm typecheck`: passed across all four packages.
- Tests: 151 passed — Contracts 2, Agent Core 78, Server 51, Web 20.
- Production build: Contracts, Agent Core, Server, and Web passed. Vite required the approved filesystem-boundary rerun already documented in `task_plan.md`; no build assertion failed.
- `git diff --check`: passed; only Windows LF/CRLF conversion notices were emitted.
- Secret scan: only empty/placeholders, synthetic test keys, and server-side variable reads were found; no real credential was found.
- Real network/model requests made by verification: 0.

## Credits

- Real OpenAI Next requests during implementation: 0.
- Real Eazo requests during implementation: 0.
- Credits consumed during implementation: USD 0 / Eazo 0.
- Fixtures: mocks and synthetic text only.

## Risks and Rollback

- The event key expires with the event; runtime must not depend on it after the displayed expiry.
- The gateway is a third-party routing layer and its checked guide did not state retention terms. Do not send identifiable private chats or screenshots.
- The Web consent states that retention is unknown and requires de-identification, but it cannot independently verify that a user actually removed every identifier.
- Listed model availability does not prove identical structured-output, vision, latency, or tool behavior across models; each selected capability needs a bounded smoke test.
- The in-process request counter resets on restart and is not a billing ledger. Keep Railway at one replica and set a hard USD cap on the event key.
- A custom third-party Provider that ignores the supplied AbortSignal could keep its own work running; the built-in OpenAI-compatible and Eazo adapters abort their underlying fetches.
- Successful model responses are currently read into memory before schema validation. Response-size caps remain a follow-up hardening item for a broader public launch.
- Rollback is to disable the generic Provider variables and leave Eazo plus local/manual fallbacks unchanged.

## Next Evidence Planned Before Production

- Create a low-cap test key outside source control after local verification passes.
- Run the same synthetic guidance fixture against the bounded text candidates and record schema success, safety success, latency, and cost.
- Run one de-identified screenshot through `qwen3-vl-plus` and verify reading order, speaker labels, text accuracy, manual review, latency, and cost.

These checks were later completed with synthetic data; see `evals/reports/production-smoke-latest.md` for the bounded results and billing boundary.

## Railway Redeploy Check

- Target checked: `https://web-production-fb777.up.railway.app`.
- `GET /health`: HTTP 200, request ID `afad7353-2931-4958-8d03-0ced9294d2cf`.
- One synthetic text request returned HTTP 200 in 7,340 ms with valid low-risk guidance and two message options, request ID `b20b57db-6df3-4f39-8d68-7fb62c2787f4`.
- The response omitted all three headers required by the locally completed code: `X-ALC-Guidance-Source`, `X-ALC-Guidance-Provider`, and `X-ALC-Prompt-Version`. Its upstream Provider and exact charge therefore cannot be confirmed; count it conservatively as one possible paid model request.
- A second diagnostic used deterministic high-risk input and returned `risk=high`, category `manipulation`, request ID `dec7115c-c01a-46d1-828b-00dcd44882ff`. This path stops before any model call, but its response also omitted the provenance headers.
- Local `HEAD` and `origin/main` are both `ebaf9e11aa4d4c79019e858ea652926008b68dc3`; all event-Provider changes remain uncommitted in the working tree. The Railway action therefore restarted or rebuilt an older source/image rather than the completed local implementation.
- Do not run another paid smoke test until the reviewed local changes are committed, pushed, and a new Railway build is confirmed.

## Production deployment result

- Commit `64b2a3c` (`feat(provider): add event gateway integration`) was pushed to private GitHub `main`.
- Railway was not connected to the GitHub repository. The reviewed source was therefore uploaded explicitly with Railway CLI rather than relying on `redeploy`.
- Deployment `d9c72d7c` failed before cutover because the environment contained `MODEL_API_KEY` without the required generic Provider base URL and model names. Railway kept the previous healthy instance serving traffic.
- Added the missing non-secret settings only: `MODEL_API_BASE_URL=https://api.openai-next.com/v1`, `TEXT_MODEL_NAME=deepseek-v3.2`, and `VISION_MODEL_NAME=qwen3-vl-plus`. Existing secret values were not printed, copied, or changed.
- Deployment `678f3999` became `SUCCESS`. `GET /health` returned HTTP 200, and a deterministic safety request returned `local_safety / deterministic-safety`, confirming the new provenance code without a model call.
- The first full guidance request stopped at the original 18-second overall budget and returned `local_fallback`. Two metadata-only `/models` checks confirmed the gateway and both configured model IDs; a 16-token direct diagnostic returned HTTP 200 in 2.8 seconds.
- Railway production now sets `MODEL_CHAIN_TIMEOUT_MS=30000`, leaving approximately 15 seconds below the browser's 45-second deadline. Redeploy `6848d005` became `SUCCESS`.
- The final synthetic guidance request returned HTTP 200 in 26,463 ms with source `remote`, Provider `openai-compatible:deepseek-v3.2`, Prompt `guidance-v2`, low risk, and three message options. Request ID: `f923a862-568c-43b7-81ab-7a1154ae86b8`.
- Prompt v3 added evidence to every substantive judgment and caused the same `deepseek-v3.2` production path to exhaust the 30-second budget. A metadata-only `/models` check confirmed `gpt-4.1-mini-2025-04-14`; changing only `TEXT_MODEL_NAME` produced a valid remote Prompt v3 result in 14,793 ms. The Eazo fallback remains enabled.
- Initial Prompt v2 rollout usage: three OpenAI Next attempts — one timed out with unknown billing, one successful 16-token diagnostic, and one successful full guidance call. This count is not the project total; later Prompt v3 production requests, including screenshot and MCP, are recorded separately in `evals/reports/production-smoke-latest.md`, where exact upstream and billing counts remain unknown.
- Deployment follow-up: the private repository is now connected to Railway production branch `main`. Push `b4f8da4` automatically triggered deployment `85d2083d-067a-4640-9fa6-22770cc5cd41`, proving that later pushes no longer require `railway up`.
