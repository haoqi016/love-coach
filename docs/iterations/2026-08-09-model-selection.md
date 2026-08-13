# Per-request analysis model selection

Date: 2026-08-09

## Goal

Let a user choose the text model used for relationship guidance without exposing credentials, allowing arbitrary upstream model names, changing screenshot OCR behavior, or multiplying the one-minute remote budget.

## Product behavior

- The Context step offers one native, keyboard-accessible “分析模型” selector.
- `auto` remains the default and recommended choice.
- The list is loaded from `GET /api/models`; a catalog failure does not block an `auto` request.
- The selector controls only text relationship analysis. Screenshot OCR keeps its automatic vision Provider chain.
- A chosen model is preserved when the user returns to adjust relationship context. Loading the synthetic sample resets it to `auto`.

## Routing contract

- Existing REST and MCP clients may omit `analysisModelId`; the shared request Schema supplies `auto`.
- `auto` preserves the verified OpenAI-compatible → Eazo → deterministic-local order.
- An explicit model alias resolves to exactly one prebuilt remote Provider. Failure or timeout returns deterministic local guidance instead of silently using another remote model.
- REST and MCP call the same immutable resolver and keep the same `GuidanceOutput` and provenance behavior.
- Every route retains one shared 60-second remote deadline. A selector does not create a second budget or an automatic retry.

## Security boundary

- Public IDs are opaque lowercase aliases, not upstream model identifiers supplied by the client.
- The server parses an optional `TEXT_MODEL_OPTIONS_JSON` allowlist at startup and rejects duplicates, the reserved `auto` ID, invalid text, unknown Provider types, or choices without matching credentials.
- The public catalog contains only `id`, `label`, `description`, and `recommended`; it excludes Provider type, upstream model routing, API URLs, keys, Eazo App ID, and private key.
- Unknown or removed aliases fail before a remote fetch.
- Local implementation and verification use mocked Providers only; no real chat, screenshot, API key, model call, event allocation, or Eazo Credit is used.

## Compatibility and rollback

- Without `TEXT_MODEL_OPTIONS_JSON`, the server derives explicit choices from the already configured primary text model and Eazo text model, so the existing Railway deployment remains valid.
- Static Web builds expose only “本地基础整理（静态演示）” and make no model-catalog request.
- Rollback is atomic: remove the model-catalog UI/request field and return REST/MCP to the single static `GuideOptions`; Provider, Prompt v3, output evidence, safety, OCR, and storage behavior are otherwise unchanged.

## Verification

- Contracts: 15/15 tests; build, typecheck, and lint passed.
- Agent Core regression: 86/86 tests passed without changes to Provider or Prompt behavior.
- Server: 67/67 tests; build, typecheck, and lint passed. Tests cover sanitized catalog output, legacy `auto`, selector-only `auto`, explicit OpenAI-compatible and Eazo selection, explicit failure to local-only fallback, unknown REST/MCP aliases with zero upstream fetches, one shared resolver, and injected-Provider compatibility.
- Web: 31/31 tests; production build, typecheck, and lint passed. Tests cover the catalog request, 8-second metadata timeout, selected request ID, static zero-network mode, inaccessible/removed selections, retry state, and labelled/disabled controls.
- Full workspace: 199/199 tests, production build, typecheck, lint, `git diff --check`, and zero-match secret/debug scan passed.
- Fixed evaluation: 17/17 cases and 359/359 checks with the fetch guard confirming 0 remote calls.
- Production smoke command remained in dry-run mode: three paths were planned and 0 network requests were made.
- Implementation Credits: 0.

## Production verification

- Commit `921d8c9` was pushed to private GitHub `main` and Railway deployed it through the existing GitHub connection.
- A non-secret `TEXT_MODEL_OPTIONS_JSON` configured the visible catalog as `auto`, `GPT-4.1 mini`, and `DeepSeek V3.2`; no credential or upstream address was changed or read.
- Railway deployment `bc8d3f8b-2f87-4c7d-bb7c-5dc172701ca7` became Online. `/health` returned `ok`, and `/api/models` returned only the sanitized aliases, labels, descriptions, recommendation flags, and default alias.
- Google Chrome loaded the production Context step, displayed all three choices, and updated the description when `GPT-4.1 mini` was selected. The analysis button was not clicked: production verification made 0 inference requests and used 0 model Credits.
