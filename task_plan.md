# Task Plan: Build and Publish A Little Closer

## Goal

Prepare A Little Closer for competition dynamic evaluation: keep the event gateway integration reliable, connect GitHub-to-Railway automatic deployment, add evidence-grounded judgments, establish a fixed evaluation suite, and verify text, screenshot, and MCP production paths with bounded paid tests.

## Phases

- [x] Phase 1: Confirm project instructions, scope, and model defaults.
- [x] Phase 2: Inspect current contracts, provider boundaries, server wiring, and Eazo request/response contract.
- [x] Phase 3: Implement the Eazo provider, configuration, REST/MCP wiring, and screenshot support.
- [x] Phase 4: Add/update tests and documentation without making paid model calls.
- [x] Phase 5: Run build, typecheck, lint, tests, security checks, and diff/file review.
- [x] Phase 6: Minimal Eazo draft App created, both models configured, current source deployed to Railway, and one de-identified public Eazo text smoke test passed.
- [x] Phase 7: Produce the implementation report and handoff.
- [x] Phase 8: Implement Prompt v2, speaker-aware screenshot extraction, visible model/fallback provenance, and review-driven safety hardening.
- [x] Phase 9: Add durable changelog and iteration records, run full verification, and prepare deployment handoff.
- [x] Phase 10: Audit the upload set, initialize Git, create a private GitHub repository, push `main`, and verify repository privacy and commit identity.
- [x] Phase 11: Add a reusable OpenAI-compatible text Provider and provider-chain fallback without duplicating Prompt v2.
- [x] Phase 12: Wire OpenAI Next into Server configuration, rate/budget guards, REST, MCP, and screenshot extraction while preserving Eazo and local fallbacks.
- [x] Phase 13: Add tests and durable documentation for the temporary event gateway, key-expiry boundary, model selection, and zero-secret handling.
- [x] Phase 14: Run full lint, typecheck, tests, build, security scan, and diff review without making real model calls.
- [x] Phase 15: Commit and push the reviewed integration, deploy the new source to Railway, and verify both no-model safety provenance and the event Provider path.
- [x] Phase 16: Connect private GitHub `main` to Railway production and verify the source/branch settings.
- [x] Phase 17: Define evidence-reference contracts and a versioned fixed evaluation dataset with measurable pass criteria.
- [x] Phase 18: Implement evidence-grounded guidance across contracts, Prompt, providers, UI, and tests.
- [x] Phase 19: Implement and run the repeatable local evaluation harness; save a machine-readable and human-readable report.
- [x] Phase 20: Push the reviewed change, confirm GitHub-triggered Railway deployment, and run bounded production text, screenshot, and MCP tests.
- [x] Phase 21: Run final lint, typecheck, tests, build, secret scan, diff review, and record deployment/test evidence.
- [x] Phase 22: Remove the 5–20-sentence UX restriction, raise the full-chat technical limit, and enforce one shared 60-second remote-analysis deadline across text and screenshot Provider chains.
- [x] Phase 23: Update tests and durable records, run the zero-remote verification suite, push through GitHub, and verify the Railway deployment without exposing credentials.
- [x] Phase 24: Audit the current text-provider registry, REST/MCP contracts, provenance, and Web state flow for per-request model selection.
- [x] Phase 25: Add a server-owned model allowlist, a sanitized discovery endpoint, and one shared per-request resolver for REST and MCP.
- [x] Phase 26: Add an accessible analysis-model selector to the Web flow, preserve automatic screenshot OCR routing, and cover selection/fallback behavior with mock-only tests.
- [x] Phase 27: Run the full zero-remote verification suite, review the diff and security boundary, document the iteration, then push and verify GitHub-triggered Railway deployment.
- [x] Phase 28: Audit the live landing page at desktop/mobile sizes and define the refined “教恋 · A Little Closer” visual hierarchy.
- [x] Phase 29: Implement the landing-page brand, headline, CTA, feature tags, privacy-card density, contrast, spacing, and restrained motion changes.
- [x] Phase 30: Verify accessibility, responsive behavior, interaction regressions, unit tests, typecheck, lint, and production build without model calls.
- [x] Phase 31: Review the final diff, record the UI iteration, push through private GitHub, and verify the GitHub-triggered Railway deployment.
- [x] Phase 32: Audit the current production landing page at 375/768/1280/1920 and identify the exact centering and visual-balance gaps.
- [x] Phase 33: Implement a centered landing composition and restrained paper-letter visual refinements without changing the product flow.
- [x] Phase 34: Re-test responsive layout, accessibility, interactions, unit tests, typecheck, lint, and production build with zero model calls.
- [x] Phase 35: Review and document the centered-layout iteration, then prepare the GitHub/Railway handoff.
- [x] Phase 36: Verify the current OpenAI Realtime/WebRTC, voice-agent, tool, model, and cost boundaries against official documentation.
- [x] Phase 37: Audit the current Web, Server, Contracts, Agent Core, MCP, safety, provenance, and model-selection integration points for voice refinement.
- [x] Phase 38: Define the hybrid realtime-voice refinement architecture, privacy/safety boundary, cost controls, test criteria, and single-developer delivery estimate.
- [x] Phase 39: Implement the feature-flagged P0 voice session, transcript review, and structured refinement path with mock-only tests.
  - [x] 39.1: Add strict voice contracts, compact trusted context, prompt boundary, and reusable turn-safety adapter.
  - [x] 39.2: Add sanitized capabilities, Realtime session minting, per-turn safety, lease controls, and guarded refinement routes.
  - [x] 39.3: Add the result-page voice sheet, interruptible WebRTC session lifecycle, transcript/summary review, and result replacement.
  - [x] 39.4: Add mock-only contract/core/server/Web tests, dependency lockfile, privacy copy, and architecture documentation.
- [x] Phase 40: Run fixed voice scenarios, one bounded paid smoke session, full regression verification, then push and verify Railway only after explicit approval.
- [x] Phase 41: Audit the deployed typography and visual hierarchy at desktop and mobile sizes, with emphasis on Chinese font rendering.
- [x] Phase 42: Replace broad Songti usage with a modern local-first Chinese type system while preserving the warm paper-letter identity.
- [x] Phase 43: Re-verify landing, workflow, result, and voice surfaces for responsive layout, contrast, focus, tests, typecheck, lint, and build.
- [x] Phase 44: Record the typography iteration and prepare a reviewed GitHub/Railway handoff without pushing until explicitly requested.
- [x] Phase 45: Remove the remaining decorative serif token and make every interface surface explicitly sans-serif after the user's screenshot review.
- [x] Phase 46: Soften only the landing headline's size, weight, line height, and tracking after the user found the no-serif version visually too heavy.
- [x] Phase 47: Add a self-hosted, open-source Chinese display font for the fixed landing headline without changing body or workflow typography.
- [x] Phase 48: Verify font loading, fallback behavior, responsive layout, tests, typecheck, lint, build, bundle impact, license inclusion, and zero model usage.
- [x] Phase 49: Record the webfont iteration, commit and push private GitHub `main`, then verify the automatic Railway deployment and production-rendered font.
- [x] Phase 50: Reproduce the reported OCR failure with the supplied long chat screenshot and capture the browser/API result without retries.
- [x] Phase 51: Correlate the request with Railway logs and audit the vision Provider, timeout, image-size, token, and fallback paths.
- [x] Phase 52: Record the confirmed root cause, distinguish model-quality limits from integration failures, and recommend the smallest fix without changing production until authorized.
- [x] Phase 53: Replace the normal speech/noise overlap disconnect with a muted waiting state while preserving the per-turn safety gate.
- [x] Phase 54: Preserve timer and confirmed notes on genuine voice errors; add regression tests for harmless boundary noise and unsafe transcript overlap.
- [x] Phase 55: Run Web verification, review the diff, push the scoped fix, and verify the GitHub-triggered Railway deployment.
- [x] Phase 56: Diagnose the reported early-ended Realtime assistant response from UI state, client event handling, and sanitized production logs without changing code.
- [x] Phase 57: Redesign voice refinement around a required preselected draft and a repeatable result-to-voice loop.
- [x] Phase 58: Bind the selected draft into the Realtime session and make “end conversation” generate a Prompt v4 result automatically.
- [x] Phase 59: Carry the refreshed guidance request and voice context token into later rounds while preserving safety, evidence, and failure behavior.
- [ ] Phase 60: Run zero-remote contract/core/server/Web verification, review the final diff, then commit, push, and verify GitHub-triggered Railway deployment.

## Key Questions

1. Can REST and MCP share one provider instance without duplicating model logic?
2. Can the screenshot extractor use the same Eazo App AI proxy while keeping manual review fallback?
3. Which Eazo errors must remain visible during dedicated connectivity tests while still allowing normal demo fallback?
4. Are the required Eazo app credentials available for Railway without exposing them locally or in source control?
5. Does the supplied OpenAI API project support Realtime WebRTC and `POST /v1/realtime/client_secrets`, rather than only Chat Completions-compatible text/audio endpoints?
6. Does `gpt-realtime-2.1-mini` preserve the voice safety and clarification quality of the larger `gpt-realtime-2.1` on the same fixed scenarios?

## Decisions Made

- Text default: `deepseek.v3.2` for the best competition balance of quality and cost.
- Vision default: `qwen.qwen3-vl-235b-a22b-instruct` for Chinese chat screenshot OCR.
- Integration path: documented server-side Eazo App AI billing proxy, not browser-side calls and not Creator regeneration.
- Paid-test budget: at most three initial smoke-test requests, well below the project instruction limit of 20 requests / estimated 5 Credits.
- Fallbacks: preserve the deterministic local guidance provider and manual screenshot transcription.
- Change history: use Git for exact diffs when enabled, `CHANGELOG.md` for user-visible changes, and `docs/iterations/` for goals, evidence, tests, Credits, and rollback notes.
- Runtime provenance: expose a small response envelope outside the guidance contract so REST can show `Eazo AI` versus `local fallback` without weakening MCP's strict structured output.
- GitHub publication: create a private repository named `a-little-closer` by default, exclude all local credentials/build artifacts, and push only the reviewed source and documentation.
- OpenAI Next integration: use its OpenAI-compatible API as the competition-period primary Provider, retain Eazo as the second remote Provider and the deterministic local Provider as the final fallback, and keep one shared Prompt v3 contract.
- Credential boundary: implement and verify with mocks only; never create, read, log, or commit a real event API key during code changes.
- Event text runtime: use `gpt-4.1-mini-2025-04-14` after the Prompt v3 DeepSeek request exhausted the 30-second budget; retain Eazo as the tested second remote Provider.
- Long-chat runtime: do not impose a sentence-count rule. Keep a high character/file safety cap, but allow full copied chat histories within that cap.
- Timeout boundary: one business request gets one shared 60-second remote-inference budget. Provider fallbacks may use only the remaining time; their waits must never add up to more than 60 seconds. The browser may wait a few extra seconds only to receive the server fallback/error response.
- Model-selection scope: the user selects only the relationship-analysis text model. Screenshot OCR keeps automatic model routing so the UI does not expose a second, confusing selector.
- Model-selection default: `auto` preserves the verified primary remote → Eazo → deterministic-local chain.
- Explicit model semantics: an explicit selection uses only that selected remote model and may fall back to deterministic local guidance, but never silently substitutes a different remote model.
- Model allowlist: model IDs, labels, and provider bindings are defined server-side. The browser receives only sanitized option metadata and cannot submit an arbitrary upstream model name, API URL, or credential.
- Timeout preservation: every selection still uses the same single 60-second request budget; adding model choice must not multiply remote time or paid attempts.
- UI refinement direction: keep the existing warm paper-letter visual language; introduce “教恋 · A Little Closer” as the bilingual brand, use “你的专属恋爱沟通教练” as the promise, and describe the initial audience as people who are not confident expressing themselves rather than using “直男” as a label.
- UI refinement scope: change presentation and copy only. Do not alter Provider routing, MCP, safety, storage, OCR, or analysis contracts.
- Centered-layout direction: center the landing narrative, actions, and feature summary as one composition; keep the privacy note visually subordinate and preserve the existing warm editorial paper identity.
- Centered-layout scope: homepage presentation only. Do not center long-form workspace pages or alter input, analysis, model-selection, safety, REST, or MCP behavior.
- Voice architecture: use a hybrid path. Realtime speech-to-speech handles clarification and rehearsal; the existing Agent Core and selected text Provider regenerate the authoritative Prompt v3 result.
- Voice transport: use browser WebRTC with a server-minted short-lived client secret. Keep the standard OpenAI API key on Railway and do not proxy continuous audio through Railway.
- Voice evidence boundary: completed voice turns are user clarification context, never quoted evidence of what the other person said. Preserve the original `conversationText` as the evidence source.
- Voice evaluation boundary: keep MCP unchanged as the machine-evaluation path. Voice is a product/demo differentiator and must not weaken or block REST, screenshot, or MCP behavior.
- Voice privacy default: do not store raw audio; keep transcript/summary in the current session unless the user explicitly confirms final refinement.
- Voice model candidate: evaluate `gpt-realtime-2.1` as the quality baseline and deploy `gpt-realtime-2.1-mini` by default only if the fixed voice suite passes.
- Voice response gate: enable input transcription, disable automatic Realtime responses, run the deterministic server check on each completed transcript, and issue `response.create` only for an allowed turn; transcription failure fails closed.
- Voice duration boundary: the competition MVP uses a five-minute browser timer plus a best-effort single-instance lease. Client-secret expiry does not terminate an active call; OpenAI project limits are the hard P0 cost backstop, and sideband/shared state is deferred until public-scale use.
- Voice refinement boundary: merge only user-confirmed notes into the existing 2,000-character `context`, never into `conversationText`, and reuse the complete `/api/guidance` guard, abort, Provider, validation, and provenance path.
- Typography direction: use a modern local-first Chinese sans stack across the complete interface, including English stamps, numbers, and symbols. Keep only the separate handwritten accent for the small English note; avoid all generic serif fallback and external font downloads.
- Webfont refinement: preserve the local-first sans system for all reading and interaction surfaces, but self-host the open-source LXGW WenKai regular webfont for the fixed landing headline only. Do not depend on a third-party font CDN or apply the display face to forms, results, or generated text.

## Errors Encountered

- A PowerShell `rg` check passed a wildcard path literally and returned Windows path error 123 after still confirming the new phase lines. Rechecked the planning files with explicit paths; no source file was affected.
- The first PowerShell projection of Railway HTTP logs piped directly after a `foreach` block and failed with `An empty pipe element is not allowed`. Retried with an explicit results array; the query then completed without exposing IP or user-agent fields.
- The first Web test run for the voice overlap fix hit the known Windows sandbox boundary before Vite could read `apps/web/vite.config.ts`. The unchanged approved rerun outside the restricted sandbox passed 67/67 tests; no application assertion failed.
- The first Web build for the self-hosted font iteration hit the known Windows sandbox boundary before Vite could read `apps/web/vite.config.ts` (`Cannot read directory "../../../../..": Access is denied`). No application code or font assertion ran; rerun the unchanged build with approved filesystem access.
- PowerShell `Get-ChildItem -Filter` was incorrectly given an array while checking planning files; reran the check with `Where-Object` and confirmed the files did not exist.
- Attempted to read a guessed `packages/contracts/src/input.ts`; the actual conversation contract is stored in `conversation.ts`. No files were changed by the failed read.
- The first full `pnpm test` run passed contracts (2/2) and agent-core (17/17), then the Web Vite startup was denied while reading above the workspace (`Cannot read directory "../../../../..": Access is denied`). This is an execution-sandbox boundary, not a test assertion failure; rerun the Web test with approved filesystem access and run Server tests separately.
- The first full `pnpm build` run built contracts and agent-core, then hit the same Web/esbuild sandbox denial while loading `vite.config.ts`; rerun the Web/root build with approved filesystem access.
- The first full `pnpm lint` run found one pre-existing Web test style violation in `apps/web/src/api.test.ts` (`consistent-type-imports` on an inline `import()` return type). Replaced it with an explicit type-only namespace import, then rerun verification.
- The first production-dist smoke request used a guessed goal value (`plan_next_step`) that the shared contract correctly rejected with `INVALID_INPUT`; rerun with the supported `invite_to_meet` enum value.
- After adding a new exported Eazo error code, the first root `pnpm typecheck` resolved the stale `agent-core/dist` declaration and rejected the server reference. Updated the root typecheck/test scripts to build the shared package first so standalone verification cannot use stale workspace declarations.
- Passing Node's `--env-file-if-exists` flag directly to the `tsx` CLI caused its Windows launcher to fail. Changed the dev command to invoke Node directly with `--import tsx --watch`, keeping root `.env` loading explicit.
- While checking the logged-in Eazo UI, the first browser call guessed a nonexistent `tabs.open()` method and the first reassignment reused an uninitialized binding. Recovered with `tabs.new()` plus `tab.goto()`; no account state or App data was changed.
- GitHub CLI (`gh`) is not installed. Git Credential Manager is present, but its first account-list check could not persist credentials with the configured `wincredman` store. Continue through the authenticated GitHub browser and use Git Credential Manager only for the final HTTPS push.
- The first unsandboxed push rejected the sandbox-owned working directory as `dubious ownership`; retry with a command-scoped `safe.directory` override instead of modifying global Git configuration.
- The retry opened GitHub's OAuth flow but timed out while waiting for the account's six-digit `Confirm access` verification. Re-run the push after the user completes GitHub verification; no files reached the remote during the timed-out attempt.
- After the user completed GitHub verification, the retry succeeded and configured local `main` to track `origin/main`. The private repository and remote branch are now available at `https://github.com/echo1047/a-little-closer`.
- The first Agent Core lint pass rejected a control-character regular expression under `no-control-regex`; replaced it with an equivalent code-point check, then passed 69/69 Core tests, typecheck, lint, and build.
- The first README/CHANGELOG patch matched an incomplete form of the existing Credits paragraph and was rejected without changing either file; re-read the exact section and replaced the complete model-configuration block.
- The first Web verification run could not start Vite/esbuild inside the restricted filesystem sandbox; the approved rerun passed 15/15 tests. No application assertion failed.
- Integration review found three P1 gaps before deployment: no shared Provider-chain deadline/client cancellation, no explicit third-party processing consent, and no generic-vision output limit. Phase 13 was extended to fix and test all three without remote calls.
- Final review found a pre-listener disconnect race and weaker Eazo URL normalization. Added the immediate `request.aborted || response.destroyed` check, rejected Eazo URL credentials/query/fragment, and reran the affected checks.
- Railway CLI could not connect the private repository because the Railway GitHub App had no repository access. Opened the GitHub installation flow, restricted access to `echo1047/a-little-closer` only, and paused at GitHub's six-digit sudo verification; implementation work continues while the user completes that account-owned step.
- The first Server test run after Prompt v3 had two stale assertions expecting `guidance-v2`; updated only those remote-provider expectations to `guidance-v3` and reran the Server checks.
- The first root test run after the evidence changes passed the fixed suite, Contracts, and Agent Core, then the restricted Windows sandbox denied esbuild access while loading the Web Vite config. The approved unchanged rerun outside that sandbox passed the then-current suite; after the shared evidence Schema was tightened, final verification passed all 164 tests. This was an environment boundary, not an application assertion failure.
- The first production Prompt v3 text smoke used `deepseek-v3.2`, reached `overall_timeout` at 30,485 ms, returned the deterministic fallback, and stopped before screenshot/MCP as designed. The gateway `/models` metadata then confirmed `gpt-4.1-mini-2025-04-14`; switching only `TEXT_MODEL_NAME` reduced the same text path to 14,793 ms and allowed the bounded remaining paths to run.
- The first full-workspace build and test attempts for the full-chat iteration reached the known Windows sandbox boundary: Vite/esbuild could not read the Web config through the restricted parent path. The unchanged approved reruns outside that boundary passed. No application assertion or compilation step failed.
- The first Web test run for the landing-page refinement hit the same known Vite/esbuild parent-directory sandbox denial before loading any test assertion. The unchanged approved rerun passed 31/31 Web tests.
- Chrome's screenshot command timed out twice and its viewport override did not change the existing extension tab. Desktop layout was still verified from Chrome's rendered DOM. The in-app test browser applied exact 375/768/1280 viewport overrides after reload and completed the responsive measurements without changing page data.
- The first attempt to stop the temporary preview guarded for only `pnpm`/`node`, but `Start-Process pnpm.cmd` returned a `cmd` wrapper. The stop was intentionally refused; the actual port 4173 listener was then resolved, verified as `node`, and stopped together with the wrapper.
- Python Playwright was unavailable in the local environment (`ModuleNotFoundError`). No dependency was installed; responsive inspection continued with the built-in browser.
- The first Chrome audit tab became detached before navigation, Chrome did not support the documented `networkidle` wait, and its full-page capture later timed out. The audit moved to a fresh built-in-browser tab, which produced exact 375/768/1280/1920 measurements without changing page data.
- The first Web production build in the restricted sandbox hit the known Vite/esbuild parent-directory access denial before loading application code. The unchanged approved rerun passed together with 31/31 Web tests, typecheck, and lint.
- A hidden `pnpm` preview wrapper did not expose port 4173 inside the restricted process view, and the later foreground preview outlived its command timeout. The exact listener was resolved as `node ... vite.js preview --host 127.0.0.1 --port 4173`, stopped by PID after browser verification, and the port release was confirmed.

## Status

**Phase 60 is in progress.** The iterative voice loop has passed 408/408 workspace tests, typecheck, lint, production build, `git diff --check`, the 17/17 fixed evaluation (359/359 checks), and the local no-credit UI check with 0 remote calls. Remaining work is the scoped commit and push, then Railway health and static production verification.
