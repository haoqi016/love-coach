# Notes: Eazo Provider Integration

## Official Eazo behavior

- Viewer-facing App AI should use the server-side billing proxy:
  `POST ${EAZO_APP_AI_API_BASE}/api/app-ai/chat`.
- The documented production base is `https://eazo.ai/creator`, yielding
  `POST https://eazo.ai/creator/api/app-ai/chat`.
- Required server-only values: `EAZO_APP_AI_API_BASE`, `EAZO_APP_ID`, `EAZO_PRIVATE_KEY`, and selected model keys.
- Request authentication uses `Authorization: Bearer <private key>` and `x-eazo-app-id`.
- The request body includes `app_id`, `model_key`, `messages`, optional `viewer_user_id`, `stream`, and `params`.
- This no-login MVP should omit `viewer_user_id`; IP addresses and request IDs are not valid substitutes for a stable authenticated user ID.
- An unavailable App AI balance/capability may return HTTP 402 with `app_ai_unavailable`.
- Eazo supports OpenAI-compatible non-streaming ChatCompletion responses and SSE, but strict JSON Schema behavior is not publicly guaranteed.
- Do not force `response_format`; use a strict JSON-only prompt, parse the assistant content, and validate it with `GuidanceOutputSchema`.
- Do not automatically retry timed-out paid calls because the upstream request may still complete and consume Credits.

## Repository starting point

- `packages/agent-core` exposes a `ModelProvider` boundary and validates all outputs with the shared Zod schema.
- Guidance currently defaults to `LocalModelProvider`; REST and MCP do not inject a remote provider.
- Screenshot extraction already has an OpenAI-compatible implementation and a manual-review fallback.
- The server has body limits, request IDs, safety preprocessing/postprocessing, and public `/health`, `/api/guidance`, and `/mcp` routes.

## Test constraints

- Run all local checks before any paid request.
- Use only synthetic/de-identified fixtures.
- Initial paid tests: one text REST call, one screenshot/OCR call, and one MCP call.
- Dedicated connectivity tests must disable local fallback so a remote failure cannot be mistaken for success.
- Do not store raw prompts, chat text, screenshots, or credentials in test logs.

## Final local implementation state

- Eazo requests are HTTPS-only and use one reusable App AI client.
- REST and MCP share one text provider; screenshot extraction uses the same guarded fetch path.
- Railway's `RAILWAY_PUBLIC_DOMAIN` is added to the Host allowlist automatically.
- A process-local gate caps concurrent public requests, per-minute requests, and 24-hour real model attempts; screenshot requests also have a combined-byte cap.
- The short-window permit is held through the complete REST/image/MCP inference operation; REST path variants share the same route middleware, while MCP initialization and tool discovery do not consume inference permits.
- Deterministic risk cannot be downgraded by a provider, and every user-visible output string is scanned for prohibited advice.
- Normal demo flows retain local/manual fallbacks; `pnpm test:eazo` performs one direct, no-fallback, synthetic connectivity call when credentials are available.
- With explicit user approval, created an unlisted Eazo Creator draft named `A Little Closer AI Gateway`. Its preview returned HTTP 200 and displayed `App AI ready`, `deepseek.v3.2`, and `qwen.qwen3-vl-235b-a22b-instruct`; Eazo's own review reported no runtime errors.
- Eazo's history attributed 80 Credits to `A Little Closer AI Gateway` and 1 Credit to `App build usage`. The post-build balance was 639 Credits. App AI usage remained empty, so no text/vision model call was made in this creation pass.
- Model cards showed current Eazo rates of 20.67/61.67 Credits per 1M input/output tokens for DeepSeek V3.2 and 17.67/88.67 for Qwen3 VL 235B A22B.
- The draft was not published; the profile's public `我的应用` count remained zero. The sandbox contains platform-managed App AI environment configuration, but no safe external export path was confirmed. No App ID/private key was read, copied, logged, or stored.
- All local/provider tests still use mocks. Real Eazo App AI requests in this implementation pass: 0.
- Known deployment limit: the daily counter is process-local and resets on a Railway restart or scales per replica. Keep one replica for the competition, leave auto-recharge disabled, and treat the provider-side Credits balance as the hard spending ceiling; use durable shared metering before a broader public launch.

## First public Railway smoke test

- Target: `https://web-production-fb777.up.railway.app`.
- `GET /health`: HTTP 200 with `{"status":"ok","service":"@alc/server"}`.
- One and only one synthetic `POST /api/guidance`: HTTP 200 in 640 ms; request ID `234bce40-b68a-48bf-90e1-41b54cac888c`.
- The returned summary, all three message texts, and next step exactly matched a local `guideNextConversation` call using `LocalModelProvider` for the same fixture.
- Eazo account still showed `暂无 App AI 用量`, so the request did not complete an Eazo model call and consumed no Eazo model Credits.
- Diagnostic boundary: search the newest Railway deployment logs for `[eazo] guidance_failed code=...`. A present line identifies the sanitized provider error; no line indicates the deployed process did not enable the Eazo provider (for example, variables were attached to another service/environment or were not included in the active deployment).

## Railway source diagnosis and successful Eazo smoke

- Railway UI confirmed all four Eazo variables were non-empty in the correct `web / production` service; secret values were never revealed or copied.
- Deployment `96af2062` was a `reason: redeploy` of the old image digest `sha256:049ec31...`; its build log showed `COPY apps`, `COPY packages`, and `pnpm build` all cached. Changing variables had restarted the previously uploaded source snapshot rather than uploading the new Eazo implementation.
- After local lint/typecheck, all 64 tests, and the production build passed, the current source was uploaded with Railway CLI as deployment `9f490dd3` (`Deploy Eazo provider integration`).
- The new snapshot changed from 91 kB to 115 kB, rebuilt `apps`, `packages`, dependencies, and the production bundle, passed Railway's `/health` check, and became `SUCCESS` with a new image digest.
- One synthetic public `POST /api/guidance` returned HTTP 200 in 12,252 ms; request ID `05d5bc49-71c6-4c78-97d4-967a92ac6c56`. The content differed from the deterministic local fixture and Railway emitted no `[eazo] guidance_failed` record, confirming the deployed text path completed through Eazo rather than the local fallback.
- Real Eazo App AI requests made after the fixed deployment: 1 text guidance call. Screenshot/OCR and MCP paid smoke calls remain unrun.

## Prompt v2, OCR labels, and runtime provenance

- Prompt contract `guidance-v2` separates observable facts, uncertainty, and low-pressure action. The remote result must preserve deterministic risk and match the user's selected tone in its first message option.
- Screenshot OCR treats visible commands as untrusted text, requires one of three speaker labels on every non-empty line, rejects malformed or over-8000-character output, and retains manual-review fallback.
- The upload UI requires users to confirm the screenshot came from their own chat interface before applying the right-bubble-is-self convention.
- REST keeps the existing `GuidanceOutput` body and adds sanitized source/provider/prompt-version headers. MCP output remains unchanged.
- Web handles remote, local fallback, local safety, local demo, and missing-header compatibility without exposing credentials, raw prompts, or provider errors.
- Deterministic output checks now also reject deliberate anxiety tactics and attempts to bypass a refusal or block with another account.
- Final local verification: lint and typecheck passed; 96/96 tests passed; production build passed; mobile-width browser check found no horizontal overflow or console errors.
- Real Eazo requests for this iteration: 0. Credits consumed: 0. Railway still runs the previous deployment until a new source deployment is explicitly approved.

## Private GitHub publication

- Repository: `https://github.com/echo1047/a-little-closer`.
- Visibility was confirmed as `Private` in the authenticated GitHub repository page before the first push.
- Upload audit: 73 tracked files, zero files larger than 10 MB, no real `.env`, and zero matches for common GitHub/API/Railway secret patterns.
- Initial source commit: `477b2c7` (`feat(app): build A Little Closer relationship agent`).
- Local commit identity is scoped to this repository as `echo1047 <echo1047@users.noreply.github.com>`.
- `main` tracks `origin/main`; GitHub authentication is managed by Git Credential Manager and no token was copied into the repository or task logs.

## OpenAI Next event gateway

- The organizer-provided portal confirmed a temporary USD 500 multi-model allocation with USD 0 consumed and no API key created at inspection time.
- OpenAI-compatible SDK base URL is `https://api.openai-next.com/v1`; the raw chat endpoint is `/v1/chat/completions` with Bearer authentication.
- The same gateway also exposes Anthropic Messages at `/v1/messages`, but this application will keep one OpenAI-compatible integration path.
- The event page displayed key expiry `2026-08-11 00:00` without a timezone. The code must therefore preserve Eazo and local/manual fallbacks and avoid treating this gateway as a long-term dependency.
- Portal documentation lists `claude-sonnet-4-6`, `gpt-5.6-terra`, `deepseek-v3.2`, and `qwen3-vl-plus` among current resources. Model names are gateway routing identifiers and require bounded capability tests before selection.
- API keys can be capped and at most three were available. A proposed operational split is a low-cap local-test key, a separately capped Railway key, and one unused emergency slot.
- The checked pages did not state chat or screenshot retention terms. Only synthetic or de-identified fixtures are permitted until that boundary is clarified.

## OpenAI-compatible Provider implementation

- Runtime text order is generic OpenAI-compatible → Eazo App AI → deterministic local. REST and MCP share the same ordered `GuideOptions`; response provenance names only the accepted Provider.
- Runtime screenshot order is generic vision → Eazo vision → manual entry. Both remote attempts use the shared guarded fetch and are limited to 8 seconds each.
- Generic vision fixes `max_tokens` at 1200 and disables streaming. All screenshot output remains subject to speaker-label, length, injection, and manual-review checks.
- Built-in OpenAI-compatible and Eazo requests receive the caller AbortSignal. A disconnected browser does not start the next Provider; the text chain has an 18-second total budget and returns a local fallback if that internal deadline expires while the client remains connected.
- Phase 13 originally added an unchecked remote-processing consent gate. A later UX simplification removed that blocking panel from screenshot and text submission while preserving the screenshot-perspective confirmation and all server-side guards.
- Final local verification: lint and typecheck passed; 151/151 tests passed; all production packages built; secret and whitespace checks passed. Real OpenAI Next/Eazo requests for this implementation: 0.

## Railway redeploy did not include the local Provider changes

- Health check passed, but one synthetic guidance response and one no-model safety response both omitted the provenance headers present in the reviewed local code.
- The synthetic guidance request completed in 7.34 seconds; because the deployed image did not identify its Provider, treat it as one possible paid request with unknown gateway/Eazo attribution.
- The safety diagnostic returned `high/manipulation` locally and did not call a model.
- `HEAD` and `origin/main` remain at `ebaf9e1`; the OpenAI-compatible integration is still an uncommitted working-tree change. A Railway redeploy cannot include it until commit and push (or a direct local-source deployment) is explicitly performed.

## Event Provider production rollout

- Integration commit `64b2a3c` (`feat(provider): add event gateway integration`) was pushed to private GitHub `main`.
- Railway had no GitHub source connected, so a UI redeploy only restarted the previous image. The current local source was uploaded with Railway CLI instead.
- First source deployment `d9c72d7c` failed safely before cutover because `MODEL_API_KEY` existed without `MODEL_API_BASE_URL`, `TEXT_MODEL_NAME`, and `VISION_MODEL_NAME`. The old healthy instance remained public.
- Added only the three missing non-secret values: `https://api.openai-next.com/v1`, `deepseek-v3.2`, and `qwen3-vl-plus`; the existing key was neither read nor changed.
- Source deployment `678f3999` passed Railway health checks. A deterministic safety request returned HTTP 200 with `local_safety / deterministic-safety`, proving the provenance-capable build was live without calling a model.
- The initial complete guidance request reached the 18-second service budget and returned `local_fallback`. The gateway `/models` metadata endpoint was healthy and confirmed both configured model IDs; a 16-token `deepseek-v3.2` request completed in 2.8 seconds.
- Set the production-only `MODEL_CHAIN_TIMEOUT_MS=30000`. Railway redeploy `6848d005` passed health checks; the code default remains 18 seconds.
- Final synthetic guidance request returned HTTP 200 in 26,463 ms with `remote / openai-compatible:deepseek-v3.2 / guidance-v2`, request ID `f923a862-568c-43b7-81ab-7a1154ae86b8`, low risk, and three message options.
- This rollout made three OpenAI Next inference attempts: one timed out with unknown billing, one successful 16-token diagnostic, and one successful full guidance call. Two `/models` requests were metadata-only. No screenshot or MCP paid test was run.
- Railway still uses CLI source uploads rather than GitHub automatic deploys; future Git pushes will not reach production until the repository is connected or `railway up` is run again.

## Competition evaluation hardening scope

- P0: connect Railway to private GitHub `main`, then prove automatic deployment on the implementation commit.
- P0: add fixed, versioned fixtures covering normal conversation, uncertainty, boundaries, manipulation, privacy, crisis escalation, tone, and evidence grounding.
- P0: run three production paths with synthetic/de-identified data only: text REST, PNG screenshot OCR, and MCP tool invocation.
- P1: every substantive judgment must point to a short excerpt from the supplied conversation instead of presenting unsupported interpretation as fact.
- Paid-test ceiling for this pass: one text REST call, one screenshot OCR call, and one MCP inference call, with at most one retry only for a transport failure. Stop after the evidence needed for pass/fail is available.

## Grounded guidance local verification

- Prompt v3 and the shared contract require exact 1-120 character chat substrings for factual evidence, and explicitly label action-only bases as advice rather than chat facts.
- The fixed v1 suite passes 17/17 cases and 359/359 checks with a fetch guard confirming 0 remote attempts. Output-content assertions exclude evidence quotes and enum metadata, so copied input cannot satisfy generated-analysis checks.
- Full workspace verification passes 164/164 unit tests, root lint, root typecheck, and the production build.
- The synthetic screenshot contains four left/right message bubbles with no embedded speaker labels. The production runner stays dry without explicit `--confirm-remote=RUN`, performs no script-level retry, and stops after the first failed path.
- OpenAI Next and Eazo usage for this local implementation and verification remains 0. Production usage is recorded separately below.

## GitHub-triggered Railway deployment and production validation

- Installed the Railway GitHub App and restricted its repository access to `echo1047/a-little-closer` only. Railway production is connected to private GitHub branch `main`.
- Pushing commit `b4f8da402cc5ea03e29f6936d01e7dc414fa9f0f` triggered deployment `85d2083d-067a-4640-9fa6-22770cc5cd41` automatically. No `railway up` or manual source upload was used for this proof.
- The deployment became `SUCCESS` with `configFile=/railway.json`, `builder=DOCKERFILE`, and `healthcheck=/health`; the public health endpoint returned `{"status":"ok","service":"@alc/server"}`.
- The first Prompt v3 REST text request used `deepseek-v3.2`, reached the 30-second total budget, returned `local_fallback`, and stopped the smoke after one business request. Duration: 30,485 ms. Railway's sanitized error was `overall_timeout`.
- A metadata-only `/models` request confirmed `gpt-4.1-mini-2025-04-14`; it made no inference call. Railway changed only the non-secret `TEXT_MODEL_NAME` and deployed `ab9d24df-0c9b-432f-ae36-5acc448217f4` successfully.
- REST text then passed in 14,793 ms with `remote / openai-compatible:gpt-4.1-mini-2025-04-14 / guidance-v3`, request ID `36916a57-a621-478b-9a8c-8de878f63440`.
- Synthetic PNG screenshot OCR passed in 4,341 ms with exactly four labelled lines, all ten expected fragments, and mandatory manual review; request ID `146c4e91-a1eb-46a5-b5b6-77efd36dd434`.
- MCP listed only `guide_next_conversation`, returned matching structured/text output, and passed the shared evidence schema in 27,637 ms with `remote / eazo-app-ai:deepseek.v3.2 / guidance-v3`. This proves the Eazo remote fallback works, but also means that one MCP business request may have made more than one upstream model attempt.
- Successful validation used three business requests split into fail-fast batches (`text`, then `screenshot,mcp`). Including the earlier failed text diagnostic, this production session made four business requests. Exact upstream attempt count, USD charge, and Eazo Credit delta were not independently available and are not claimed.

## Full-chat input and one-minute remote deadline

- User decision: remove the “建议 5–20 句” product restriction and allow a complete chat history within a high technical character/file cap.
- User decision: cap one remote analysis at 60 seconds total. This is a shared deadline across the primary and fallback Providers, not 60 seconds per Provider added together.
- The browser may keep a small response-only allowance beyond 60 seconds so it can receive the server's local fallback or error; this does not extend model processing.
- Preserve the existing image count/size checks, request concurrency/rate limits, daily remote-attempt budget, deterministic safety checks, and manual OCR review.
- Trigger evidence: the user's 1080 x 19,298 JPEG was accepted by the public extraction route, but generic vision and Eazo both hit their old short timeouts and the route returned an empty manual-review fallback. The implementation pass must use only mocks/local fixtures; no paid model call is needed until after deployment.
- Implemented one shared `MAX_CONVERSATION_TEXT_LENGTH=60_000` across Contracts, Web text areas, REST/MCP input validation, and OCR validation. Vision output uses `max_tokens=8192`.
- Text REST/MCP and the complete generic-vision to Eazo-vision chain now share `MODEL_CHAIN_TIMEOUT_MS=60000`; browser and production smoke clients wait 70 seconds only for upload/response overhead.
- Local verification: build, typecheck, lint, 175/175 unit tests (including exact-limit MCP transport), 17/17 fixed cases, 359/359 fixed checks, production smoke dry-run, script syntax, secret-pattern scan, and `git diff --check` passed. Remote model calls: 0.
- The first root build/test attempts hit the known restricted Vite/esbuild parent-directory access error. Approved unchanged reruns outside that sandbox passed; this was not an application failure.
- Commits `015e4b6` and `39e1148` reached Railway through the private GitHub connection. Deployment `7d2b5819-451f-46ac-8a2d-83299e0da04b` became Active; `/health` returned `ok`, and the landing page showed the complete-chat wording.
- Railway `MODEL_CHAIN_TIMEOUT_MS` was verified as `60000`; no other variable value was read or changed.
- One production boundary test used the user-authorized 1080 x 19,298 JPEG. It returned HTTP 200 in 61,496 ms, request ID `ed053dcc-d545-4b2a-b07d-c2fe48735460`, 0 extracted characters, and manual review. The one-minute cutoff is correct, but extremely tall screenshot OCR remains unsolved without tiling. Raw content was neither logged nor saved by this task; upstream attempt count and cost are unknown.

## Per-request analysis model selection

- User request: add an option to choose different models.
- Scope assumption: the selector controls relationship-analysis text generation only; screenshot OCR remains automatically routed because it has a different capability and already requires manual confirmation.
- Default choice: `auto`, retaining the production-tested OpenAI-compatible primary, Eazo fallback, and deterministic local fallback.
- Explicit choice contract: honor the chosen remote model; if it fails or exhausts the shared budget, return deterministic local guidance rather than silently using a different remote model.
- Security boundary: publish only a sanitized server allowlist (`id`, display label, description, availability/recommended flags). Do not accept arbitrary model IDs, expose base URLs, or send API credentials to the browser.
- Shared behavior: REST and MCP must resolve model choices through the same registry and preserve truthful provenance. All choices continue to share one 60-second total remote deadline.
- Implementation verification must use mock Providers only. A bounded production smoke test is deferred until the new deployment is active and should not include private or real chat content.
- Implemented a strict shared `GuidanceRequest` with `analysisModelId=auto` as the backward-compatible default, plus a sanitized catalog contract with a unique selectable default.
- Implemented `TEXT_MODEL_OPTIONS_JSON`, startup-time immutable Provider registration, a non-billable `GET /api/models`, and one resolver shared by REST and MCP. Explicit choices never fall through to another remote Provider.
- Implemented the Context-step native select, 8-second catalog loading, non-blocking retry, static local-only display, removed-choice reconciliation, and truthful result provenance.
- Final review found and fixed one selector-only edge case: when no legacy `TEXT_MODEL_NAME` exists, `auto` now follows the declared allowlist order instead of silently running local. Legacy defaults still keep their existing generic → Eazo order.
- Local verification passed 199/199 tests (Contracts 15, Agent Core 86, Server 67, Web 31), build, typecheck, lint, 17/17 fixed cases, 359/359 checks, smoke dry-run, secret/debug scan, and diff review. Real model calls: 0; Credits: 0.
- Commit `921d8c9` was pushed to private GitHub `main` and triggered Railway automatically. The final non-secret catalog configuration deployment was `bc8d3f8b-2f87-4c7d-bb7c-5dc172701ca7` and reported Online.
- Metadata-only production verification passed: `/health` returned `ok`; `/api/models` returned `auto`, `event-gpt41-mini`, and `eazo-deepseek-v32` with labels/descriptions only. No Provider, upstream model, URL, App ID, or credential field was exposed.
- Google Chrome verified that the Context step displayed “自动选择（推荐）”, “GPT-4.1 mini”, and “DeepSeek V3.2”; selecting GPT updated the visible description. The analysis button was not clicked, so this production verification used 0 model calls and 0 Credits.

## 教恋 landing-page refinement

- User-approved brand direction: `教恋 · A Little Closer`, “你的专属恋爱沟通教练”, and an audience description centered on people who are not confident expressing themselves. Avoid “工科直男” as a permanent exclusionary label and avoid presenting relationship advice as a deterministic formula.
- Preserve the existing warm paper/letter visual system. Priority fixes: lock the two-line hero headline, reduce desktop vertical whitespace, increase muted-text contrast, clarify both CTA labels, shorten the privacy card, add three feature tags, make mobile buttons full width, and keep motion subtle with `prefers-reduced-motion` support.
- UI/UX helper guidance emphasized scanability, explicit hierarchy, stronger contrast, crisp borders, subtle shadows, and no decorative gradient that hides hierarchy. Its generic Inter/Space Grotesk typography recommendation is intentionally not adopted because it conflicts with the product's existing editorial Chinese paper-letter identity.
- Scope boundary: Web presentation and copy only; no model API, Provider, MCP, OCR, safety, privacy-storage, or output-contract changes. Verification must make 0 inference requests and use 0 Credits.
- Baseline Chrome measurement at 1367x756: the old hero title was 253px high and started at y=174; the CTA row started at y=542; the privacy card started at y=197. The title's second sentence wrapped again, producing the reported visual issue.
- New Chrome desktop measurement at the same size: title is 147px high at y=138 with exactly one client rect for each intended line; CTA row starts at y=442; privacy card starts at y=140; document width equals viewport width.
- Exact responsive checks: at 375x812, both title lines remain single-line (186px and 298px inside a 325px content column), both buttons are 325px full width, and the privacy card follows below at y=671 with no horizontal overflow. At 768x1024 and 1280x900, both title lines also remain single-line and the document width equals the viewport width.
- Accessibility/interaction checks: the H1 has a complete accessible name; features use a labelled list; native buttons remain unchanged; focus styles remain visible; the card motion uses a dedicated transform animation and the existing `prefers-reduced-motion` rule; local browser console reported 0 warnings/errors.
- Current Web verification: 31/31 tests, typecheck, lint, and production build passed. The implementation and browser checks made 0 inference requests and used 0 Credits.
- Full regression verification passed 199/199 tests (Contracts 15, Agent Core 86, Server 67, Web 31), root build/typecheck/lint, and the fixed evaluation at 17/17 cases and 359/359 checks with 0 remote calls.
- Independent code review found no P0/P1 issue. It confirmed the global `--ink-soft` change only improves contrast without changing layout, the welcome-specific button rules do not affect later steps, the title fits all measured widths, and reduced-motion covers the new card transition. A future automated browser smoke test for viewport and CTA navigation is useful but non-blocking because the exact browser checks passed in this iteration.
- Commit `bad3d4c` was pushed to private GitHub `main` and deployed automatically by Railway. Deployment `d0941562-a2b4-4ffc-8422-ee4d8094f86a` reported Online and `/health` returned `ok`.
- Production Chrome at 1367px confirmed the new document title, bilingual brand, two one-line title elements, three feature tags, both new CTA labels, and no horizontal overflow. The production 375x812 check confirmed 186px/298px title lines, two 325px buttons, and a 329px privacy card with no overflow. No analysis button was submitted; production verification used 0 model calls and 0 Credits.
## Centered landing-page refinement (2026-08-09)

- User request: center the overall landing composition and improve visual polish while retaining the warm paper-letter identity.
- Scope boundary: welcome screen only. Preserve the upload, OCR, model-selection, analysis, safety, REST, and MCP behavior.
- Required visual checks: 375px mobile, 768px tablet, 1280px desktop, and 1920px wide desktop; verify horizontal overflow, title wrapping, CTA sizing, focus states, and visual balance.
- Implementation principle: center the narrative as a single composition rather than applying global text centering to long-form workflow pages.
- Production baseline: no horizontal overflow at 375/768/1280/1920. At desktop the outer 1080px container was centered, but its columns were about 667px/359px (65/35) and the content stayed anchored near y=112 while tall-view growth accumulated below it.
- Chosen fix: preserve readable left-aligned editorial copy, rebalance desktop columns to 1.15/0.85, vertically center the two-column row inside the welcome min-height, remove the card's manual 30px top offset, and center the 600–899px copy container.
- Visual polish: slightly stronger paper-card depth, brighter feature-pill paper surfaces, balanced coral/sage outline circles, and 11px brand/footer small text.
- Shared chrome exception: the 11px brand subtitle and footer apply to every application step, intentionally improving small-text readability without changing workspace layout.
- Browser verification after the change:
  - 375x812: no horizontal overflow; both title lines remain single rects; both CTAs remain 325px wide; privacy card center x=180.
  - 768x1024: copy width 630px at x=69, centered on x=384; privacy card center is also x=384.
  - 920x820: two-column union center x=461 against viewport center x=460; no title or CTA overflow at the tight desktop layout.
  - 1280x900: grid tracks 584/432px; content union center x=630 against viewport center x=640 and center y=406 against viewport center y=450.
  - 1920x1080: content union center x=950 against viewport center x=960 and center y=486 against viewport center y=540.
- Mobile upload-page regression: 325px header/workspace/footer, 281px upload box, no horizontal overflow.
- Verification: 31/31 Web tests, typecheck, lint, 124-module production build, `git diff --check`, browser console 0 warnings/errors, and independent review with no P0/P1 findings.
- Remote inference during this iteration: 0 requests, 0 Credits.
- Production state: commit `2c5d83d` reached private GitHub `main` and Railway deployment `49329ee5-0504-4f6f-99e6-a3289409a63d` became Online.
- Production verification: `/health` returned `ok`; 1280x900 reported 584/432px grid tracks, centered grid content, visual center x=630/y=406, and two one-rect title lines; 375x812 retained two 325px CTAs and no document overflow. Console warnings/errors: 0.

## Realtime voice refinement design (2026-08-10)

- User goal: add a live spoken conversation with the model so the user can correct misunderstandings, add goals/boundaries, rehearse wording, and then obtain improved advice.
- Official OpenAI guidance distinguishes direct speech-to-speech sessions from chained STT/reasoning/TTS workflows. The selected design is hybrid: Realtime voice for clarification and rehearsal, existing Agent Core for the authoritative revised `GuidanceOutput`.
- Browser transport should be WebRTC. Railway mints a short-lived client secret with a server-only standard API key; continuous raw audio does not need to traverse Railway.
- `gpt-realtime-2.1-mini` is the default deployment candidate; `gpt-realtime-2.1` is the current quality baseline. Both support function calling and live audio but not Structured Outputs, so neither may bypass Prompt v3/schema/evidence/safety checks.
- Voice clarification belongs in bounded user `context`; it must not be appended to partner `conversationText` or cited as evidence of the other person's behavior.
- P0 uses an explicit `更新建议` action after transcript/summary review. Model-initiated tools and role-play are later phases after fixed tests.
- Raw audio is not stored by default. Completed user-turn transcripts remain in memory for the active session, are editable before refinement, and are excluded from logs, service-worker caches, and analytics.
- High/crisis outputs do not enter ordinary dating-coach mode. Input transcription is enabled, automatic response creation is disabled, and each completed turn must pass the deterministic server check before `response.create`; missing transcription fails closed.
- The five-minute competition limit is enforced by the browser lifecycle plus a best-effort single-instance lease. Client-secret expiry does not terminate an established WebRTC call; project spend/rate limits remain the hard P0 cost boundary.
- Confirmed voice notes are merged into the existing 2,000-character `context` without silent truncation. The final `/api/voice/refine` path must reuse the existing route guard, abort, model resolver, Prompt v3 validation, and provenance behavior.
- Official pricing is token-based and later conversation turns resend context, so no fixed per-minute promise is recorded. Measure 3/5-minute fixed sessions and record P50/P95 usage, latency, interruptions, and final-result quality.
- Estimated one-developer base P0: 32-50 focused hours; with a 25% account/ASR/mobile risk reserve, plan roughly 40-63 hours. Voice improves product demonstration and clarification quality but does not replace the existing MCP dynamic-evaluation path.
- Implementation prerequisites: confirm that the supplied API project supports Realtime WebRTC and `/v1/realtime/client_secrets`; enter the real key only in Railway private variables. No key, remote request, Credits, code change, Git push, or Railway change occurred in this planning pass.

## Realtime voice refinement implementation (2026-08-10)

- Phase 39 completed locally behind `VOICE_ENABLED=false`; source release and the paid smoke remain separate Phase 40 actions requiring explicit approval. The development process did not read or change Railway secret values.
- The browser now pre-authorizes the microphone and preloads the Realtime SDK before requesting a client secret. The server sends the standard API Key only to the exact official `https://api.openai.com/v1` origin, requests a 10-second client secret, validates its `ek_` format/expiry, and never returns the standard key.
- Completed voice turns remain lease-bound and pass deterministic server safety before an explicit reply request. Missing, duplicate, overlapping, out-of-order, high-risk, or crisis transcripts fail closed. Generated transcript chunks use the stricter realtime output guardrail every 12 characters.
- Closing, navigation, timeout, permission races, SDK-load failure, and refinement cancellation stop microphone tracks and abort pending work. Confirmed notes enter only bounded user context; final output still uses Prompt v3, evidence checks, model selection, request budgets, and provenance.
- Competition deployment requirement: one Railway replica, a five-minute UI limit, and OpenAI project hard spend/rate limits. Browser gates and process-local leases are defense-in-depth, not a malicious-client or cross-instance hard boundary; sideband or a server-owned voice chain remains required before broad public release.
- Final zero-remote verification passed: 340/340 tests (Contracts 24, Agent Core 166, Server 91, Web 59), root typecheck, lint, production build, 17/17 fixed cases, 359/359 checks, production smoke dry-run, secret scan, and `git diff --check`. The Realtime SDK lazy chunk is 617.83 kB (177.55 kB gzip), a non-blocking build warning.
- Real OpenAI/Eazo requests: 0. Credits/charges: 0. The next gated step is Phase 40: enter the Realtime key directly in Railway, run one bounded paid voice smoke, then push/deploy only after explicit approval.

## Cross-platform typography refinement (2026-08-10)

- User feedback: the broad Songti treatment made the interface feel dated. Preserve the warm paper-letter visual language, but modernize the Chinese reading and interaction surfaces.
- Production audit found 44 `var(--serif)` uses across the main and voice CSS. The named serif stack was primarily macOS-oriented and did not match installed Windows fonts, so Windows could fall through to an uncontrolled generic Songti-style face.
- Chosen type system: a local-first sans stack using Segoe UI Variable/Segoe UI, PingFang SC, Microsoft YaHei UI/YaHei, Noto Sans CJK SC, system-ui, and sans-serif. No external font download, CDN, tracking request, or layout-blocking webfont was added.
- Chinese brand text, hero/page headings, form labels, transcript editors, model selector, analysis content, message drafts, footer, voice consent, live subtitles, status, and note editing now use the sans/display tokens.
- Follow-up screenshot decision: remove the decorative serif exception as well. English stamps, numbers, arrows, and information marks now also use the sans stack; `--serif`, `Songti`, `STSong`, generic `serif`, and `var(--serif)` are absent from the Web CSS.
- Readability changes: key explanatory and metadata text was raised from 8–10px to 11–12px, controls remain at least 11–14px, the inactive progress color changed from `#8c938e` to `#66746e`, and Chinese footer copy no longer uses italic styling.
- Browser verification used the local production build only: 375x812 landing and upload, 768x1024, 900x900 breakpoint, and 1280x900. All measured widths had no horizontal overflow; the hero stayed at two deliberate lines, upload/page H1 used the new sans stack, and buttons remained 52px high.
- The strict no-serif follow-up also opened the 1280px fictional-sample “你的意图” page: H1 46px/600, legends 20px/600, choice titles 14px/600, and descriptions 11px/400 all resolved to the same sans stack with no horizontal overflow.
- Landing headline follow-up: user judged the 600-weight, 61.44px desktop sans headline too close to an advertising heavy-black style. Keep the no-serif decision, but use 500 weight, a 34–52px mobile/tablet range and 52–58px desktop range, 1.12 line height, and restrained negative tracking. Other workflow headings remain unchanged.
- Verification: 59/59 Web tests, Web typecheck, lint, production build, `git diff --check`, and browser inspection passed. The known Realtime SDK 617.83 kB lazy-chunk warning remains unrelated and unchanged.
- Remote inference during this iteration: 0 requests, 0 Credits. No Provider, MCP, OCR, safety, contract, API key, GitHub, or Railway configuration was changed.

## Self-hosted landing headline font (2026-08-10)

- User decision: stop relying on visitor-installed fonts for the fixed landing headline. Keep the rest of the application on the existing local-first sans stack.
- Selected dependency: `lxgw-wenkai-webfont@1.7.0`. The package is version-locked in `apps/web/package.json` and `pnpm-lock.yaml`; only `lxgwwenkai-regular.css` is imported.
- Runtime behavior: Vite rewrites the package's WOFF2 URLs to same-origin hashed assets. The package supplies `font-display: swap` and Unicode ranges, so the browser loaded only five subsets for “有些靠近，从好好说话开始。” rather than the complete font.
- Measured local production load: five font requests totaling 229.35 KB. The built font catalog is 97 WOFF2 assets totaling 4.42 MB; these files increase the deploy artifact, but are not all transferred to a first-time visitor.
- Typography scope: `.welcome h1` uses `LXGW WenKai` at weight 400 with the existing sans stack as fallback. Body copy, buttons, forms, workspace headings, result cards, and voice UI are unchanged.
- Responsive browser evidence: at 1280x900 the title used 55.04px/400, measured 277px and 443px for its two lines, and had no document overflow. At 375x812 it used 35.29px/400, measured 177px and 284px inside a 325px column, retained two 325px actions, and had no overflow.
- Licensing: the published `/licenses/` directory contains byte-content-equivalent (whitespace-normalized) copies of the package's SIL OFL 1.1 font license and MIT Webfont-wrapper license.
- Verification: Web 59/59 tests, typecheck, lint, production build, browser font readiness, responsive checks, and console review passed. Remote inference: 0 requests, 0 Credits.

## Header copy cleanup (2026-08-10)

- Removed the desktop-only “不替你发送 · 不判断好感概率” header note to reduce disclaimer-like visual noise in the competition presentation.
- Kept the privacy card, no-auto-send behavior, evidence constraints, safety routing, and project documentation unchanged.
- Reframed the privacy card as “分享聊天前的小提醒” with three user-approved sentences, and reduced the heading from 27px/600 to 24px/500 so the card remains warm without becoming overly intimate or wrapping to an orphan character.

## Long-screenshot OCR diagnosis (2026-08-10)

- Reported symptom: after uploading the supplied long chat screenshot, the校对 step shows an empty textarea and the notice “图片文字未自动识别”.
- Diagnostic boundary: run one explicit production reproduction with this supplied image, inspect the sanitized response and correlated Railway logs, and do not infer “OCR model quality” until Provider/configuration/timeout/fallback causes are eliminated.
- Input facts: JPEG, 1,029,565 bytes, 1080 × 19,298 pixels, 20.84 megapixels, 17.87:1 aspect ratio. It is within the byte limit but far outside an ordinary single-screen aspect ratio.
- Latest production evidence: 2026-08-10 16:05:27 UTC+8, `POST /api/extract` returned HTTP 200 after 60,233 ms; upstream time was 60,226 ms and the response was the empty manual-review fallback. Deployment `1db16725…` corresponds to commit `3b14345` and remained SUCCESS/RUNNING.
- Runtime configuration evidence: the generic vision path is enabled with `qwen3-vl-plus` through the event gateway; the Eazo vision path is also configured. The generic Provider and the full Provider chain both share one 60-second deadline, so the primary request consumed the entire budget and left no useful time for Eazo.
- Code-path cause: the server sends the original screenshot as one Base64 image with no resize, vertical tiling, overlap, or truncation detection. The UI's notice means HTTP-200 manual fallback, not an upload-format failure.
- Comparative evidence: the same 1080 × 19,298 boundary image previously returned 0 characters after 61,496 ms, while the small four-message synthetic screenshot completed successfully in 4,341 ms. This supports a long-image handling failure rather than a globally broken Vision API.
- Recommended next implementation: tile very tall screenshots into readable 1080 × roughly 2,400-pixel segments with overlap, OCR bounded batches under one overall deadline, merge in source order with overlap deduplication, reserve time for the fallback Provider, and return sanitized OCR provenance/failure reason to the UI.

## Voice overlap stability fix (2026-08-10)

- Root cause: a `speech_started` boundary arriving while the previous turn was transcribing or in server safety review caused an immediate fail-closed disconnect. The error path also reset the visible timer to `05:00`, making a new-session failure look like a duration expiry.
- The Web now carries Realtime `item_id` through speech start/stop, transcription, and item-deletion events. A distinct gate-time item is muted and deleted from the conversation; an approved response waits for every deletion acknowledgement.
- Safety remains fail-closed for unknown or late items after a response is pending/active, malformed ordering, missing deletion acknowledgement after four seconds, or missing transcription terminal state after ten seconds.
- Duplicate deletion acknowledgements are idempotent, multiple acknowledgements may arrive out of order, and only the final expected acknowledgement can release exactly one `response.create`.
- Error state preserves elapsed time and confirmed notes. Both server-issued and browser-updated semantic VAD use low eagerness to reduce natural pauses being split prematurely.
- Verification: Web 67/67 tests, Server 91/91 tests, both package typechecks, both package lint/build checks, `git diff --check`, and two independent read-only race/safety reviews. All requests were mocked; real model/network calls: 0.
- Release evidence: commit `fb825a6` reached Railway deployment `55b14635-3246-4ad8-a75e-31f4d4ba47db` with `SUCCESS` / `RUNNING`; production health returned `ok` and the sanitized capabilities endpoint reported voice enabled, `GPT Realtime 2.1 Mini`, `Marin`, and a 300-second maximum. These GET checks did not mint a Realtime client secret or consume model credits.

## Voice response early-termination diagnosis (2026-08-10)

- Symptom: the assistant subtitle stopped at “你有想”, the UI returned to “正在听你说”, and no error card appeared.
- Browser evidence: the affected tab still loaded the pre-release entry asset `index-BtFD-Geg.js` and old voice chunk `index-BLM8E7qn.js`; the current deployment loads `index-DM8t3cL6.js`. A hard refresh is required before attributing this test to commit `fb825a6`.
- Exact UI path: assistant transcript deltas populate `assistantSubtitle`; switching only the phase to `listening` preserves that subtitle. This produces the observed partial quote plus listening label.
- Defect confirmed in the earlier implementation: `mapRealtimeTransportEvent()` mapped every `response.done` to a payload-free `response_completed`, discarding `response.id`, `response.status`, and `status_details`. The lifecycle stored only pending/active booleans, so a cancelled, incomplete, failed, or stale previous response could be treated as the current response completing normally.
- Official protocol boundary: `response.done` is emitted for every final state. Clients must inspect `response.status`; cancellation reasons include `turn_detected` and `client_cancelled`, while incomplete reasons include `max_output_tokens` and `content_filter`.
- Secondary paths: manual interrupt and SDK `audio_interrupted` also retain the partial subtitle and return to listening. A normal mapped VAD speech start resets the subtitle, while a guardrail/error displays an error card, so those do not match the screenshot as directly.
- Observability limit: the browser connects directly to OpenAI over WebRTC. Railway therefore cannot see raw Realtime events, and the current server logs only startup rather than sanitized session/turn/end outcomes. The exact final status for this occurrence is unrecoverable.
- Resolution in the iterative voice pass: `response.created` and `response.done` now preserve and match `response.id`; only a matching `completed` response returns to listening, stale completion is ignored, and a matching non-completed response fails closed with a visible error. Regression tests cover stale old completion and matching `cancelled`/`incomplete`/`failed` outcomes. Consuming final audio-transcript-done and adding transcript-free client telemetry remain P2 observability improvements.
- This pass was read-only for application code and production settings. No Realtime session was started and model usage was 0.
