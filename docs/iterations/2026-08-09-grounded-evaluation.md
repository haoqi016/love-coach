# Iteration: Grounded Guidance and Fixed Evaluation

Status: Complete; local baseline and production three-path smoke verified

## Goal

Make every user-visible relationship judgment auditable against the submitted conversation, then establish a fixed zero-network baseline for comparing future Prompt changes.

This iteration uses synthetic, de-identified fixtures only. It does not record a real conversation, screenshot, account identifier, credential, or raw model response.

## Baseline

- Prompt v2 asked the model to distinguish observable facts from uncertainty, but the output contract did not require a machine-checkable source for each judgment.
- Common topics and open loops were plain strings, so a reviewer could not verify which original message supported each item.
- Existing unit tests protected schemas and safety behavior, but there was no frozen multi-scenario suite for measuring Prompt changes against the same inputs.
- REST text, screenshot extraction, and MCP could be tested separately, but there was no single fail-fast production smoke command with an explicit request budget.

## Decisions and Changes

### Prompt v3 and grounded output

- Keep one `GuidanceOutput` for REST and MCP rather than creating path-specific response shapes.
- Add a strict evidence union:
  - `quote`: a 1–120 character contiguous substring copied exactly from `conversationText`;
  - `advice`: an explicit marker for an action recommendation rather than a chat fact.
- Attach evidence to the summary, interaction pattern, each mutual topic, each open loop, each topic bridge, each message option, and the next step.
- Require summary and interaction judgments to contain an original quote during normal guidance. Each mutual-topic and open-loop item must also align with at least one quote.
- Reject a remote result when a claimed quote is not an exact input substring, when evidence arrays do not align with their judgments, or when factual list items use `advice` as a substitute for evidence.
- Require every uncertainty to begin with `未知：` or `待确认：`.
- Display quotes under the visible label `聊天原文`; display action-only bases as `建议：这是行动建议，不是聊天事实`.
- Exclude validated original-chat quotes from the generated-advice regex scan. The surrounding model-written analysis and recommendation text remains fully scanned, so quoting a user's unsafe wording does not turn it into model advice.

### Fixed evaluation v1

- Freeze 17 synthetic cases under `evals/v1/cases/` covering normal guidance, limited data, fact-versus-inference, boundaries, privacy, manipulation, harassment, coercion, stalking, sexual pressure, abuse, self-harm, violence, and all five requested tones.
- Run every case twice through the deterministic local Provider and require identical normalized output.
- Replace network access with a rejecting guard; any remote call attempt fails the suite.
- Check input/output schemas, risk and provenance, target tone, safety, evidence coverage, quote source, aligned evidence matrices, and scenario-specific expectations.
- Write reusable JSON and Markdown reports under `evals/reports/`.

### Production three-path smoke

- `pnpm smoke:production` is a dry run unless both a base URL and `--confirm-remote=RUN` are supplied.
- A confirmed run executes `text → screenshot → mcp`, with no automatic retry and immediate stop after the first failed path.
- A complete successful run issues at most three business inference requests. A configured Provider chain may make more than one upstream model attempt for one business request, so the business-request count is not a billing ledger.
- The smoke report stores path status, request IDs, non-sensitive provenance, and aggregate checks; it does not store credentials, full chat text, screenshots, or raw model output.

Commands:

```powershell
pnpm eval:fixed
pnpm smoke:production
pnpm eval:screenshot
pnpm smoke:production -- --base-url=https://web-production-fb777.up.railway.app --screenshot=tmp/evals/synthetic-chat.png --confirm-remote=RUN
```

## Verification

- `pnpm eval:fixed`: 17/17 cases passed, 359/359 checks passed, 0 remote calls.
- Evidence implementation unit tests: 110/110 passed across Contracts, Agent Core, and Web.
- Full workspace unit tests, including Server REST/MCP integration: 164/164 passed.
- Contracts, Agent Core, and Web typecheck and lint passed.
- Root lint, typecheck, and production build passed across all four workspace packages.
- `git diff --check` passed for the implementation before documentation closeout.
- GitHub push `b4f8da4` automatically triggered Railway deployment `85d2083d-067a-4640-9fa6-22770cc5cd41`, proving the source connection. The later `TEXT_MODEL_NAME` change produced runtime deployment `ab9d24df-0c9b-432f-ae36-5acc448217f4`; both used `/railway.json`, the Dockerfile builder, and `/health`.
- The three successful production paths below ran on `ab9d24df-0c9b-432f-ae36-5acc448217f4`, not on the superseded auto-deploy proof instance.
- Production REST text passed in 14,793 ms with `remote / openai-compatible:gpt-4.1-mini-2025-04-14 / guidance-v3`.
- Production screenshot OCR passed in 4,341 ms with four labelled lines, ten expected fragments, and mandatory manual review.
- Production MCP passed in 27,637 ms with one listed tool, matching structured/text output, and `remote / eazo-app-ai:deepseek.v3.2 / guidance-v3`.
- Durable production evidence: `evals/reports/production-smoke-latest.json` and `evals/reports/production-smoke-latest.md`.

## Credits

- Remote model requests during fixed evaluation: 0.
- Local implementation and fixed evaluation used 0 remote requests.
- Production validation used three successful business requests plus one earlier failed text diagnostic. The failed diagnostic stopped before screenshot/MCP.
- MCP succeeded through Eazo fallback, so a business request may contain multiple upstream attempts. Exact USD usage and Eazo Credit delta were not independently available; this record does not infer them from request count.

## Risks and Rollback Boundary

- Prompt v3 is an additive but required output-contract change. A remote model still returning the Prompt v2 shape will fail validation and follow the configured fallback path.
- Quote validation proves textual provenance, not that a quote alone establishes intent, emotion, or causality. The UI must retain uncertainty and advice labels.
- The deterministic suite validates contracts, safety, repeatability, and evidence mechanics; it does not establish the language quality of a remote model.
- The production smoke can spend model allowance. Keep it dry-run until the deployed Prompt version, environment variables, synthetic screenshot, and remaining cap are confirmed.
- Roll back the Prompt, shared contracts, Agent Core validation, Local Provider, UI rendering, and REST/MCP consumers together. Reverting only the schema or only the Prompt would make remote output incompatible.
- Keep `evals/v1` and its reports as historical evidence. If the evaluation meaning changes, add a new version instead of rewriting v1.
- Disabling remote Provider variables remains the operational rollback for avoiding further model spend; deterministic text guidance and manual screenshot entry stay available.
- `deepseek-v3.2` could not finish Prompt v3 inside the 30-second production budget. The event text model was changed to the gateway-listed, pinned `gpt-4.1-mini-2025-04-14`, which passed the same strict path in 14,793 ms. Eazo remains the second remote Provider.
