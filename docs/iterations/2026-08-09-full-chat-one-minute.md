# Iteration: Full Chat Input and One-Minute Remote Analysis

Status: Complete; production rollout and one controlled long-screenshot boundary test recorded

## Goal

Allow users to submit a complete chat history instead of following a 5–20-sentence recommendation, while keeping every business request within one minute of remote model processing.

The change must preserve privacy reminders, request-cost controls, deterministic safety checks, evidence validation, and local/manual fallbacks.

## Trigger Evidence

- The previous UI recommended only 5–20 sentences and both pasted text and OCR output stopped at 8,000 characters.
- Text Providers had 30-second individual timeouts while the production Provider chain used a 30-second total budget.
- Vision Providers had independent 8-second timeouts, so the two-stage path could spend up to 16 seconds but still fail on a very tall chat screenshot.
- A de-identified 1080 x 19,298 JPEG reached the public extraction route, but both remote vision attempts hit their old deadlines and the route returned the manual-entry fallback. The implementation pass does not preserve the image or its extracted content in project files.

## Decisions and Changes

### Full-chat boundary

- Remove sentence-count guidance from the product copy.
- Export one `MAX_CONVERSATION_TEXT_LENGTH = 60_000` constant from the shared Contracts package.
- Use that constant for input validation, both Web text areas, counters, and OCR output validation.
- Keep this high technical limit instead of accepting unbounded input; it protects JSON parsing, model context, memory, latency, and public cost.
- Raise the REST/MCP JSON parser hard ceiling from 256 KB to 512 KB so valid Unicode input at the Schema limit is not rejected first by the transport layer.

### One shared minute

- Set the built-in OpenAI-compatible and Eazo text Provider request timeout defaults to 60,000 ms.
- Set `MODEL_CHAIN_TIMEOUT_MS` default and maximum to 60,000 ms for REST and MCP.
- Wrap the complete OpenAI-compatible vision → Eazo vision path in the same 60,000 ms total deadline.
- If the primary Provider fails quickly, the fallback may use only the remaining time. If the primary consumes the minute, no paid fallback starts.
- Keep the browser and production smoke client at 70,000 ms. The additional ten seconds cover upload and response transport only; remote model processing still stops at 60 seconds.
- External MCP evaluators can impose a shorter client timeout. The server cannot override that external limit.

### Long screenshot output

- Raise vision `max_tokens` from 1,200 to 8,192 for both remote vision Providers.
- Continue to require one speaker label per non-empty line, literal transcription, manual user review, and a 60,000-character maximum.
- This iteration does not add image tiling. Extremely tall or dense screenshots can still require multiple uploads or manual correction even with the longer deadline.

## Verification

- Contracts: 11/11 tests; typecheck, lint, and build passed.
- Agent Core: 86/86 tests; typecheck, lint, and build passed.
- Server: 55/55 tests; typecheck, lint, and build passed.
- Web: 23/23 tests; typecheck, lint, and production build passed.
- Tests cover exact 60,000-character input/OCR acceptance, over-limit rejection, 512 KB transport handling, shared remaining-time behavior, and no fallback start after the deadline is exhausted.
- Full workspace verification passed 175/175 unit tests, including an official MCP-client call with exactly 60,000 characters; the 17/17-case fixed suite with 359/359 checks, root build/typecheck/lint, production smoke dry-run, script syntax, secret-pattern scan, and whitespace review also passed.
- Remote model requests during implementation: 0.
- GitHub commits `015e4b6` and `39e1148` triggered Railway automatically. Production deployment `7d2b5819-451f-46ac-8a2d-83299e0da04b` became active, `/health` returned `ok`, and the landing page showed the complete-chat wording without the old short-chat copy.
- Railway's non-secret `MODEL_CHAIN_TIMEOUT_MS` override was changed from 30,000 to 60,000 and verified in the Variables UI before the final deployment.
- One user-authorized JPEG boundary test used the previously supplied 1080 x 19,298 screenshot. `/api/extract` returned HTTP 200 in 61,496 ms, request ID `ed053dcc-d545-4b2a-b07d-c2fe48735460`, with 0 extracted characters and `requiresManualReview=true`.
- The production test proves the one-minute remote cutoff and manual fallback work. It does not prove successful OCR for an extremely tall image. No raw screenshot text was printed or stored; exact upstream attempt count and billing remain unknown.

## Risks and Rollback Boundary

- Longer input and 8,192-token OCR output can increase latency and model cost even though the request still stops at one minute. Existing daily-attempt and concurrency limits remain the operational cost guard.
- The 60,000-character application limit does not guarantee that every configured model has enough context for every input; upstream rejection still follows the existing Provider/local fallback path.
- A one-minute server deadline does not guarantee competition evaluators will wait that long. Keep the faster primary model and fixed synthetic smoke available.
- The controlled 19,298-pixel screenshot reached the one-minute boundary without extracted text. The next OCR improvement should be explicit vertical tiling/overlap and truncation detection, not a longer timeout.
- Roll back the Contracts constant, Web limits, Server OCR validation/token budget, Provider defaults, parser ceiling, and timeout documentation together. A partial rollback would create mismatched UI, transport, and Schema limits.
