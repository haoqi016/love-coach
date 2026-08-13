# Changelog

All notable product changes are recorded here. Entries describe user-visible behavior; implementation evidence and experiments live under `docs/iterations/`.

The format follows Keep a Changelog, using calendar dates because this competition project does not yet publish semantic releases.

## 2026-08-10 — Repeatable draft-focused voice refinement

### Changed

- Replaced the post-call transcript form with a draft-first loop: users select one existing suggestion before microphone access, discuss only that draft with the Realtime coach, then explicitly end the call to regenerate the structured Prompt v4 guidance.
- Manual end and the five-minute timeout now share one single-flight finalizer. Only completed, safety-approved user transcripts are used; partial ASR, zero-turn calls, duplicate terminal events, and late events from a closed session cannot trigger or overwrite a refinement.
- Successful refinement atomically adopts the revised guidance, provenance, merged request, fresh signed voice token, and new drafts. The voice entry remains available so users can select another draft and repeat the process.
- Multi-round context now uses one canonical, versioned internal block, separates historical from current-round notes, deduplicates bounded notes, replaces the previous selected draft, and preserves explicit corrections across later rounds.

### Safety and failure behavior

- The selected draft is required by both session and refinement contracts, limited to 600 single-line characters, treated as untrusted data, and checked before a Realtime secret is minted. It can guide revision but cannot become quoted evidence about the other person.
- Refinement rechecks every note and the ordered combined note text before any Provider call. Duplicate, malformed, non-terminal, or oversized internal blocks are rejected before inference.
- Voice refinement no longer uses deterministic local fallback. If the remote structured model fails, the previous visible guidance, request, and token remain unchanged instead of presenting a template that ignored the voice discussion.
- The public context field remains capped at 2,000 characters; the validated internal request budget is 5,000 characters to accommodate bounded multi-round voice metadata without silently dropping the original user context or the current round.

### Verified

- The final workspace gate passed 408/408 tests: Contracts 34/34, Agent Core 183/183, Server 102/102, and Web 89/89.
- Typecheck, lint, production build, `git diff --check`, the 17/17 fixed evaluation (359/359 checks), and the production-smoke dry run passed.
- All implementation tests used mocks and local fixtures; no Realtime or text-model request was made.

## 2026-08-10 — Selection-driven communication strategies

### Changed

- Upgraded relationship guidance to Prompt v4. The server now turns the selected relationship stage, conversation goal, and preferred tone into a trusted strategy profile instead of relying on option labels alone.
- Added 18 independently maintained policy modules: 6 relationship stages, 7 conversation goals, and 5 tones. Safety and evidence remain highest priority, followed by stage, goal, and tone.
- Made all seven goals produce different local drafts, topic bridges, and next steps; all five tones change the actual draft text; all six relationship stages change the rationale and recommended pacing.
- Made the post-conflict stage override incompatible invitation or intimacy progression, and kept playful wording serious for conflict and boundary scenarios.
- Added a server-side rejection check for remote results whose suggested depth exceeds the selected relationship stage. REST and MCP contracts remain unchanged.

### Verified

- Agent Core tests passed 179/179, Server tests passed 91/91, Web tests passed 67/67, and Contracts tests passed 24/24.
- Full typecheck, lint, production builds, and script syntax checks passed. The fixed evaluation passed 17/17 cases and 359/359 checks with 0 remote calls and 0 Credits.
- No Railway variable or production deployment was changed in this iteration.

## 2026-08-10 — Self-hosted editorial hero font

### Changed

- Removed the persistent “does not send messages / does not estimate attraction” qualifier from the desktop header so the competition landing page presents the product first; the underlying safety behavior and contextual privacy guidance remain unchanged.
- Rewrote the landing privacy card as three conversational reminders and softened its heading weight, preserving the same data-handling and evidence boundaries without presenting them like compliance rules.
- Added the open-source LXGW WenKai regular Webfont as a version-locked Web dependency and applied it only to the fixed two-line landing headline.
- Kept all body copy, controls, workflow pages, analysis results, and voice UI on the existing sans-serif system for reading speed and layout stability.
- Bundled the font through Vite so production serves it from the same Railway origin; no Google Fonts, font CDN, tracking request, or visitor-installed font is required.
- Included the complete SIL OFL 1.1 font license and MIT Webfont-package license in the published `/licenses/` directory.
- Restricted the production font Content Security Policy to same-origin resources so a future stylesheet cannot silently add an external font host.

### Verified

- The local production page reported `LXGW WenKai` loaded at weight 400 on desktop and mobile. Both intended headline lines remained single-line, both mobile actions remained full-width, and no horizontal overflow appeared.
- The headline requested five Unicode font subsets totaling about 229 KB. The production build contains 97 regular-font subsets (about 4.42 MB) so other supported headline glyphs remain available without downloading them all on first view.
- Web tests passed 59/59; typecheck, lint, production build, license comparison, console review, and whitespace review passed with 0 inference requests and 0 Credits.

## 2026-08-10 — Cross-platform typography refinement

### Changed

- Replaced broad Songti-style rendering with a local-first modern Chinese sans stack across branding, page headings, forms, transcript editing, model selection, analysis results, draft messages, footer copy, and the realtime voice sheet.
- Removed the remaining serif token and converted English stamps, numbers, arrows, and symbols to the same sans system, so no interface surface can fall back to Songti or a generic serif face.
- Softened the landing headline from 600 to 500 weight and reduced its responsive size by roughly 7–10%, preserving the two-line composition without the oversized heavy-black appearance.
- Increased key explanatory and metadata text from 8–10px to 11–12px, strengthened inactive progress contrast, and removed italic styling from Chinese footer copy.
- Kept fonts local to the device; no external font download, CDN dependency, tracking request, or additional page-load cost was introduced.

### Verified

- Local production-browser checks passed at 375x812, 768x1024, the 900px desktop breakpoint, and 1280x900 with no horizontal overflow and the intended two-line hero title preserved.
- The mobile upload page retained its full workflow width and showed 30px page headings, 16px upload guidance, and the same modern sans stack as the landing page.
- Web tests passed 59/59; typecheck, lint, production build, and whitespace review passed with 0 inference requests and 0 Credits.

## 2026-08-10 — Feature-flagged realtime voice refinement MVP

### Added

- Added a result-page, full-duplex OpenAI Realtime voice refinement sheet with 18+ confirmation, live subtitles, mute, interruption, a five-minute limit, editable confirmed notes, and one-click regeneration of the formal Prompt v3 guidance.
- Added server-only Realtime client-secret minting after microphone permission and SDK preload. The standard key is restricted to the official OpenAI origin, and the browser receives an approximately 10-second secret. Signed compact voice context, lease-bound per-turn safety checks, sanitized capabilities, best-effort session release, and the refinement route reuse the existing model resolver, request budget, evidence validation, output safety, and provenance.
- Added deterministic ASR-aware turn safety and an incremental generated-speech guardrail. Voice notes remain user context and can never become quoted evidence about the other person.

### Safety and limits

- Automatic Realtime replies stay disabled; the honest client closes its turn gate at speech stop, checks the completed transcript on the server, and only then requests a response. Missing, overlapping, or failed transcripts stop the session.
- The browser gate, output guardrail, five-minute timer, and in-memory lease are competition safeguards, not an unbypassable or cross-instance server boundary. The feature stays disabled by default; provider-side spend/rate limits and a future sideband or server-owned voice chain are required before broad public use.
- No standard API key is shipped to the browser, source, logs, or test fixtures. No real Realtime call was made during implementation.

## 2026-08-09 — Centered landing composition

### Changed

- Rebalanced the desktop landing grid from roughly 65/35 to 58/42 so the hero and privacy letter read as one centered composition instead of a left-heavy layout.
- Vertically centered the desktop composition inside the available first-screen height while preserving a deliberate 44–54px upward bias for faster access to the primary action.
- Centered the tablet copy container, removed the privacy card's manual desktop offset, and kept the stable mobile stack unchanged.
- Added restrained coral/sage outline details, slightly deeper paper-card depth, brighter feature pills, and 11px shared header/footer small text. The existing paper-letter palette, typography, and reduced-motion behavior remain intact.

### Verified

- Exact browser checks passed at 375x812, 768x1024, 920x820, 1280x900, and 1920x1080 with no horizontal overflow and one rendered rect per intended title line.
- At 1280px the visual union is centered within 10px horizontally and sits 44px above the viewport center; at 1920px the corresponding values are 10px and 54px.
- The 375px landing page retains two 325px full-width CTAs, and the following upload page retains the same 325px header/page/footer width without overflow.
- Web tests passed 31/31; typecheck, lint, production build, whitespace review, console review, and an independent P0/P1 diff review passed with 0 inference requests and 0 Credits.
- Commit `2c5d83d` deployed automatically from private GitHub `main`; Railway deployment `49329ee5-0504-4f6f-99e6-a3289409a63d` became Online and passed `/health` plus the 1280px/375px production layout checks.

## 2026-08-09 — 教恋 brand and landing-page refinement

### Changed

- Introduced the bilingual product brand “教恋 · A Little Closer” and the promise “你的专属恋爱沟通教练” across the header, landing page, result footnote, footer, document metadata, PWA manifest, and icon accessibility label.
- Fixed the hero as exactly two intentional lines at mobile, tablet, and desktop widths; reduced desktop vertical delay so the primary action appears roughly 100 pixels earlier in the tested 1367px viewport.
- Renamed the primary actions to “上传聊天，开始分析” and “先看虚构示例”, then added three compact feature tags for shared topics, reply rhythm, and next-step wording.
- Shortened and visually lightened the privacy letter while increasing muted-text contrast and small-copy sizes. Mobile buttons remain full width, and the letter follows naturally below the main copy.
- Kept the paper-letter visual system and existing page-reveal motion. The privacy card now has only a restrained hover lift, covered by the existing reduced-motion rule.

### Verified

- Exact browser checks at 375x812, 768x1024, 1280x900, and the normal 1367x756 Chrome viewport showed one client rect per intended title line and no horizontal document overflow.
- At 375px, both CTA buttons occupy the complete 325px content width and the upload step retains the same 325px header/page/footer width.
- Muted green text measures 6.04:1 against the main paper background; primary text and buttons remain above WCAG AA contrast requirements.
- Web tests passed 31/31; full workspace tests passed 199/199; production build, typecheck, lint, and the browser console check passed with 0 inference requests and 0 Credits.

## 2026-08-09 — Per-request analysis model choice

### Added

- An accessible “分析模型” selector for relationship guidance, with “自动选择（推荐）” as the default and the current server-approved models as explicit choices.
- A sanitized `GET /api/models` catalog shared by the Web app and server configuration; the response contains only opaque IDs, labels, descriptions, and the recommended flag.
- One optional `analysisModelId` field on the REST/MCP request contract. Existing clients that omit it continue to use `auto`.

### Behavior and security

- `auto` preserves the current OpenAI-compatible → Eazo → deterministic-local chain. An explicit choice calls only that selected remote model, then falls back locally if needed; the service never silently replaces it with a different remote model.
- Screenshot OCR keeps automatic visual-model routing and does not expose a second selector.
- The browser cannot submit arbitrary upstream model names, URLs, or credentials. Unknown or removed aliases are rejected before any model call, and every choice retains the same shared 60-second remote deadline.

### Verified

- Contracts passed 15 tests, Agent Core 86, Server 67, and Web 31: 199/199 in the full workspace suite.
- Production build, typecheck, lint, the 17/17-case fixed evaluation with 359/359 checks, production-smoke dry run, secret-pattern scan, and whitespace review passed.
- All implementation verification used mocked Providers or deterministic fixtures: 0 remote model calls and 0 Credits.

## 2026-08-09 — Full chats and one-minute analysis

### Changed

- Removed the “建议 5–20 句” rule. Users can now paste a complete chat history or a smaller relevant excerpt, with one shared 60,000-character technical limit.
- Raised screenshot OCR output from 1,200 to 8,192 tokens and aligned accepted OCR text with the same 60,000-character contract.
- Text REST, screenshot OCR, and MCP now share a 60-second remote-analysis deadline. A primary and fallback Provider divide that same minute instead of receiving one minute each.
- Browser requests and the production smoke client wait 70 seconds so they can receive the server's response after the 60-second inference cutoff; this allowance does not extend model processing.
- Raised the REST/MCP JSON parser ceiling from 256 KB to 512 KB so valid 60,000-character Unicode input reaches the shared Schema.

### Preserved

- Screenshot count and 5 MB per-file limits, public concurrency/rate/daily-attempt controls, evidence validation, deterministic safety routing, and local/manual fallbacks remain unchanged.
- Text guidance output stays capped separately from input; accepting a longer history does not require the model to produce a longer answer.

### Verified

- Contracts passed 11 tests, Agent Core 86, Server 55, and Web 23; all four packages passed their targeted typecheck, lint, and production build checks.
- Full workspace verification passed 175/175 tests, the 17/17-case fixed evaluation with 359/359 checks, root build/typecheck/lint, smoke dry-run, script syntax, secret-pattern scan, and whitespace review.
- Timeout tests prove that a slow primary leaves only the remainder of the shared deadline to the fallback, for both text and screenshot paths.
- The official MCP client accepts an exact 60,000-character tool input and returns validated local guidance through the 512 KB JSON transport boundary.
- Implementation verification used mocks and local fixtures only: 0 remote model calls.
- Commits `015e4b6` and `39e1148` deployed automatically from private GitHub `main`; Railway deployment `7d2b5819-451f-46ac-8a2d-83299e0da04b` became active and passed `/health` plus the updated full-chat landing-copy check.
- One user-authorized long-screenshot production request returned HTTP 200 in 61,496 ms with an empty manual-review fallback. This verifies the one-minute cutoff but not successful OCR for a 19,298-pixel-tall image; exact upstream attempts and billing are not claimed.

## 2026-08-09 — Grounded guidance and fixed evaluation

### Added

- Drag-and-drop screenshot selection with an active drop-zone state; dropped PNG/JPG files enter the existing preview and validation flow without starting OCR automatically.
- Prompt v3 evidence contract for summaries, interaction patterns, mutual topics, open loops, topic bridges, message options, and next steps.
- Exact short chat quotes for factual judgments plus an explicit `建议，不是聊天事实` marker for action guidance; fabricated or rewritten quotes are rejected before display.
- A versioned 17-case synthetic evaluation suite and machine-readable reports for repeatable Prompt comparisons.
- A dry-run-by-default production smoke command covering REST text, screenshot extraction, and MCP with shared schema and provenance checks.

### Changed

- Removed the blocking remote-processing consent panel from screenshot reading and text analysis so users can continue directly; screenshot-side confirmation remains required to prevent speaker reversal.
- Uncertainty statements now identify themselves as `未知` or `待确认` instead of presenting unsupported interpretations as facts.
- REST and MCP continue to return one shared `GuidanceOutput`; evidence is therefore evaluated and rendered consistently across both paths.
- Provenance-checked chat quotes are visually labelled as original chat text and are not misclassified as model-generated unsafe advice.
- Railway production now uses the bounded-tested `gpt-4.1-mini-2025-04-14` event model for primary text guidance; Eazo remains the second remote Provider.

### Verified

- Fixed local evaluation: 17/17 cases and 359/359 checks passed with 0 remote calls.
- Contracts, Agent Core, and Web evidence changes passed 110 unit tests, typecheck, lint, and production builds.
- Full workspace verification passed 164/164 unit tests plus root lint, typecheck, and production build.
- GitHub `main` automatically triggered Railway deployment `85d2083d-067a-4640-9fa6-22770cc5cd41` for commit `b4f8da4`, proving automatic deployment. A later non-secret model-variable change produced runtime deployment `ab9d24df-0c9b-432f-ae36-5acc448217f4`; both used `/railway.json`, the Dockerfile builder, and `/health`.
- Production smoke ran on `ab9d24df-0c9b-432f-ae36-5acc448217f4` and passed REST text, screenshot OCR, and MCP. Successful-path durations were 14,793 ms, 4,341 ms, and 27,637 ms respectively; all accepted guidance used `guidance-v3`.
- The initial DeepSeek Prompt v3 text diagnostic hit the 30-second budget and stopped the fail-fast run. After the model switch, the successful validation used three business requests. Provider fallback can produce more upstream attempts than business requests; exact billing is not claimed.

## 2026-08-09 — Temporary multi-model event Provider

### Added

- Generic HTTPS-only OpenAI-compatible text Provider with Bearer authentication, typed failures, Prompt v3 reuse, and strict guidance-contract validation.
- Ordered text fallback from OpenAI-compatible to Eazo and finally the deterministic local Provider; runtime provenance now identifies the Provider that actually succeeded.
- Ordered screenshot fallback from OpenAI-compatible vision to Eazo vision and finally manual entry.
- Generic `MODEL_MAX_*` public request, concurrency, and daily remote-attempt controls plus a one-call `pnpm test:model` connectivity check.
- A shared 18-second Provider-chain deadline, request-disconnect cancellation, and abort propagation through the built-in OpenAI-compatible and Eazo clients.
- Explicit, unchecked-by-default consent before chat text or screenshots are sent to the organizer gateway, including Eazo fallback and unknown-retention disclosure.

### Changed

- Results from a non-Eazo remote Provider now use the neutral label `AI 模型分析` while retaining the non-sensitive model name and prompt version.
- Eazo and OpenAI-compatible Providers share one Prompt v3 source and one JSON-content parser.
- Existing `EAZO_MAX_*` settings remain compatible, but `MODEL_MAX_*` takes precedence and protects both remote paths.
- Generic and Eazo screenshot attempts are capped at 8 seconds each; a two-provider failure reaches manual entry within 16 seconds.

### Security

- Text and screenshot adapters reject non-HTTPS endpoints, embedded URL credentials, and malformed API-key configuration before sending a Bearer credential.
- The temporary event key remains server-only and the event gateway hostname is not hardcoded into application logic.
- Remote text and screenshot adapters keep credentials in native private fields so routine object serialization cannot expose them.
- Generic vision requests set `max_tokens: 1200` and `stream: false` before any paid call.

### Verified

- Contracts, Agent Core, Server, and Web: 151 tests total; typecheck, lint, and production builds passed with mocked network calls.
- Cancellation tests confirm that an external disconnect does not start the next paid Provider; timeout tests confirm local/manual fallback within the configured budget.
- Real model requests and Credits used during implementation: 0.

## 2026-08-09 — Guidance trust and traceability

### Added

- Results now identify whether they came from Eazo AI, the deterministic fallback, the safety-protection path, or local demo mode. Remote results also show the non-sensitive model key and prompt version.
- Screenshot extraction labels every message as `我：`, `对方：`, or `无法判断：`; users must confirm that uploaded screenshots come from their own chat view before OCR can run.
- `CHANGELOG.md` plus one evidence-focused record under `docs/iterations/` for each meaningful product iteration.

### Changed

- Guidance Prompt v3 separates observable facts and exact chat evidence from uncertainty before suggesting a low-pressure next step, and explicitly rejects diagnosis, attraction scoring, stereotypes, manipulation, and boundary bypass.
- Remote guidance is rejected when its risk assessment or first message tone conflicts with deterministic application rules.
- Output safety checks now catch deliberate anxiety tactics and attempts to use another account to bypass a refusal or block.

### Fixed

- Commands visible inside screenshots are treated only as text to transcribe. Empty, unlabelled, fenced, malformed, or overlong OCR output now falls back to manual entry instead of reaching analysis.

### Verified

- Local lint, typecheck, 96 tests, production build, and a mobile-width browser check passed without a real Eazo request.

## 2026-08-09 — Eazo provider baseline

### Added

- Five-step mobile Web/PWA flow for confirmed chat text or screenshots.
- Shared REST and MCP guidance core with deterministic safety checks.
- Eazo App AI text provider using DeepSeek V3.2.
- Eazo App AI screenshot extraction using Qwen3-VL 235B.
- Local deterministic guidance and manual screenshot-entry fallbacks.
- Railway deployment with request, concurrency, and daily model-call guards.

### Verified

- Local lint, typecheck, 64 tests, and production build passed.
- Railway deployment `9f490dd3` passed `/health`.
- One de-identified public text request completed through Eazo in 12.25 seconds.
