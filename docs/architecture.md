# Architecture

## Goal

Expose one relationship-conversation guidance capability through both a mobile web experience and a machine-evaluable MCP tool, without duplicating business logic.

## Request flow

```text
Pasted chat text ───────────────────────────────┐
                                               │
Screenshot(s) → in-memory validation/extraction│
              → user review of extracted text ├→ shared contract
                                               │  → safety pre-check
MCP `guide_next_conversation` → text contract ─┘  → agent core
                                                  → output validation
                                                  → safety post-check

Validated result → signed compact voice context
separately submitted + validated selected draft → session instructions → short-lived client secret
                 → browser WebRTC ↔ OpenAI Realtime
completed transcript → server turn-safety gate → explicit response.create
end/timeout → safe completed user turns → existing Agent Core / Prompt v4 → revised result + fresh token
```

## Packages

- `@alc/contracts`: the only source of truth for request and response schemas.
- `@alc/agent-core`: provider-independent guidance pipeline and deterministic development provider.
- `@alc/web`: task-oriented mobile interface. It does not read messaging apps or send messages.
- `@alc/server`: REST adapters, ephemeral screenshot intake, health checks, and Streamable HTTP MCP.

Transport adapters must stay thin. REST and MCP call the same agent-core function and return the same validated output.

The Agent Core derives one trusted `strategyProfile` from validated selections:
6 relationship-stage policies, 7 conversation-goal policies, and 5 tone
policies. Both remote Providers receive only the selected three modules, while
the deterministic local Provider applies the same policy semantics. Priority is
fixed as safety/evidence > relationship stage > goal > tone; these policies may
change guidance depth, direction, topic bridges, and draft wording, but never
the observed facts, evidence, or authoritative risk result.

## State and data

- The MVP has no user accounts or durable conversation database.
- Selected image files remain in browser memory until uploaded, then in server memory only for the request lifetime.
- Raw text and images must not appear in application logs.
- The browser does not persist screenshots or chat text to local storage.
- When configured, the server can call an OpenAI-compatible event gateway and the Eazo App AI billing proxy. All API keys, App IDs, private keys, upstream URLs, and real model routing remain server-only. The browser receives only sanitized opaque model choices from `GET /api/models`.
- REST and MCP resolve the same optional `analysisModelId` through one immutable server registry. `auto` uses OpenAI-compatible → Eazo → deterministic local; an explicit model uses only that remote Provider before deterministic local fallback. Screenshot extraction remains automatic: OpenAI-compatible vision → Eazo vision → manual transcription.
- Every business request gives its complete remote Provider chain one shared 60-second deadline. A fallback can use only the time left by the primary; the browser's 70-second wait is transport allowance, not extra inference time.
- The public inference routes use a process-local requests-per-minute/concurrency gate, and the guarded remote fetch path enforces a process-local 24-hour model-attempt budget across REST, MCP, and screenshot extraction. This is a single-instance competition safeguard, not a distributed billing ledger.
- Railway's `RAILWAY_PUBLIC_DOMAIN` is added to the Host allowlist automatically; custom domains remain explicit configuration.
- Realtime voice is an optional post-analysis adapter. The standard OpenAI API Key remains server-only and may be sent only to the exact official `https://api.openai.com/v1` origin. The browser obtains microphone permission and preloads the SDK before the server mints a roughly 10-second client secret, then connects over WebRTC. Railway does not proxy continuous audio.
- The voice-context token signs only a compact allowlist of the already validated result. At session start, the client separately submits the frozen selected draft; the server validates its shape and safety again, then combines it with the verified signed-result context to build session instructions. The token does not authenticate the selected draft. Realtime does not receive the screenshot, full OCR/chat text, upstream API key, or text-model routing. The Agents SDK repeats the server-approved model, voice, transcription model, and session instructions during its initial `session.update` so it cannot accidentally replace them with SDK defaults.
- Realtime automatic response creation is disabled. The browser sends every completed input transcription to the lease-bound `/api/voice/turn-safety` route, then explicitly requests a response only for `low` or privacy-only `caution` turns. A synchronous turn gate prevents late interruption events from reopening the microphone before that decision, and an SDK output guardrail checks generated transcript chunks every 12 characters. These are honest-client competition defenses; hard server control over a deliberately modified browser requires a Realtime sideband controller or a server-owned chained voice path and is deferred.
- Clicking the explicit end-and-generate action authorizes the completed, safety-approved user transcripts from that round. They are merged into one versioned internal block inside the bounded `context`; historical and current-round notes remain distinguishable, and an explicit current correction takes priority. The original `conversationText` remains the sole source for quoted partner-chat evidence. `/api/voice/refine` requires the frozen selected draft and reuses the same model resolver, public inference permit, abort scope, Agent Core, output validation, and provenance headers as `/api/guidance`.
- A successful refinement returns a fresh signed voice-context token and the Web client atomically adopts the revised guidance, merged request, provenance, drafts, and token. A later round therefore starts from the newest result. A failed refinement preserves the previous result and cannot fall back to a deterministic provider that did not consume the voice context.
- The five-minute browser timer and process-local lease manager are best-effort single-instance controls. The competition Railway service must remain at exactly one replica. The provider project spend/rate limit is the hard P0 cost backstop; cross-instance leases and authoritative live usage require shared state or sideband control.

## Failure behavior

- Invalid input fails before provider execution.
- Screenshot extraction always requires user review before analysis.
- Provider timeout or invalid structured output never bypasses contract validation. Normal guidance falls back to the deterministic local provider, and screenshot extraction falls back to manual review.
- Dedicated provider-connectivity tests disable those fallbacks so authentication, balance, rate-limit, and response-contract failures remain visible.
- Safety escalation replaces normal dating suggestions when the input indicates immediate harm, coercion, stalking, or violence.
- Missing/failed voice transcription fails closed and produces no ordinary relationship advice. Closing, Escape, navigation, or connection failure only cleans up and never starts paid refinement. Manual end and the five-minute timeout share one single-flight finalizer; incomplete transcripts are discarded, zero safe turns generate nothing, and late events from the closed session cannot overwrite the refinement state.
