# Iteration: Prompt v2, Speaker-Aware OCR, and Result Provenance

Status: Complete locally; not yet deployed to Railway

Source: private GitHub repository `echo1047/a-little-closer`, initial source commit `477b2c7`

## Goal

Improve the trustworthiness of the core competition flow without adding new product scope.

## Baseline

- The guidance prompt enforces JSON and safety boundaries but gives limited analysis procedure.
- Screenshot extraction requests plain visible text without explicit `我 / 对方 / 无法判断` labels.
- Normal REST responses do not tell the Web UI whether Eazo succeeded or the local fallback was used.

## Decisions

- Keep the existing `GuidanceOutput` contract stable for MCP compatibility.
- Version the guidance prompt and make its analysis procedure explicit: observable facts first, uncertainty second, low-pressure action last.
- Keep OCR output as editable plain text, but require speaker labels and explicit `[无法辨认]` markers.
- Add REST-only provenance metadata rather than changing the MCP tool output contract.

## Acceptance Criteria

- Prompt injection text inside a conversation remains data, not instructions.
- Prompt explicitly prohibits diagnosis, personality labels, gender stereotypes, attraction scores, and pressure tactics.
- OCR prompt preserves reading order and labels every message as `我`、`对方`、or `无法判断`.
- Web result view distinguishes Eazo AI from local fallback and shows the prompt version.
- Existing REST/MCP output schema and safety behavior remain valid.
- Lint, typecheck, tests, and production build pass without real Eazo calls.

## Files Changed

Prompt and deterministic safety:

- `packages/agent-core/src/eazo-app-ai-provider.ts`
- `packages/agent-core/src/model-provider.ts`
- `packages/agent-core/src/guide.ts`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/src/safety.ts`
- `packages/agent-core/test/eazo-app-ai-provider.test.ts`
- `packages/agent-core/test/guide.test.ts`
- `packages/agent-core/test/safety.test.ts`

OCR and REST provenance:

- `apps/server/src/image-extractor.ts`
- `apps/server/src/app.ts`
- `apps/server/test/image-extractor.test.ts`
- `apps/server/test/app.test.ts`

Web provenance and screenshot perspective confirmation:

- `apps/web/src/api.ts`
- `apps/web/src/api.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/styles.css`

Durable records:

- `README.md`
- `CHANGELOG.md`
- `docs/iterations/README.md`
- `docs/iterations/2026-08-09-prompt-v2-ocr-provenance.md`
- `task_plan.md`
- `notes.md`

## Verification

- `pnpm lint`: passed for Contracts, Agent Core, Server, and Web.
- `pnpm typecheck`: passed for all four packages.
- `pnpm test`: 96/96 passed — Contracts 2, Agent Core 48, Server 33, Web 13.
- `pnpm build`: production build passed; Web bundle contained 120 transformed modules.
- Mobile browser check with a 390 × 844 viewport override: source status was visible, no horizontal overflow was detected, and browser console errors were zero.
- The first restricted-sandbox Web test/build attempts were blocked while Vite read local parent-directory metadata. Re-running the same commands with the required local read access passed; no assertion or compilation failure was involved.

## Credits

- Models were mocked for this iteration.
- Real Eazo requests: 0.
- Eazo Credits consumed: 0.
- No private chat or identifiable screenshot was used.

## Risks and Rollback

- Provenance must not expose credentials or raw prompts.
- OCR speaker labels remain model-generated and always require user review. Automatic right/left mapping is limited to screenshots that the user confirms came from their own chat interface.
- The deterministic advice scanner is intentionally conservative and may send a negated quotation of a prohibited tactic to the local safety fallback.
- Older servers without provenance headers remain compatible; the Web UI shows neutral `分析结果` rather than claiming a remote model was used.
- This iteration exists only in the local source until a new Railway deployment is made.
- Rollback is limited to the source files listed above; the shared `GuidanceOutput` JSON and MCP tool contract were not changed.

## Next Evidence

- After deployment approval, run one de-identified public text smoke test and confirm the page shows `Eazo AI 分析` plus `guidance-v2`.
- Separately approve one de-identified screenshot OCR test to measure speaker order, text accuracy, manual-review behavior, latency, and Credits.
