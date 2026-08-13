# Realtime voice refinement MVP — 2026-08-10

## Goal

Let an adult user clarify goals, boundaries, and preferred wording through a natural,
interruptible voice conversation after the initial chat analysis, then regenerate the
formal advice through the existing Prompt v3 evidence and safety pipeline.

## Delivered

- Strict voice contracts, signed compact trusted context, and bounded context merging.
- OpenAI Realtime client-secret minting with the standard key kept server-side.
- Microphone permission and SDK preload happen before minting; the server restricts the
  standard key to the official OpenAI origin and requests a 10-second client secret.
- Result-page WebRTC voice sheet with live subtitles, mute, barge-in, end, five-minute
  timer, editable/confirmable notes, and failure-safe preservation of the old result.
- Lease-bound completed-transcript safety checks. `speech_stopped` closes a synchronous
  local turn gate; missing, duplicate, overlapping, out-of-order, high-risk, or crisis
  turns fail closed.
- Generated speech is screened every 12 transcript characters for manipulation,
  boundary bypass, unsupported attraction probabilities, diagnosis, guaranteed
  outcomes, and assistant-dependency language.
- Final confirmed notes enter only bounded user `context`; partner-chat evidence still
  comes only from the original `conversationText`.

## Verification boundary

All implementation tests use fakes or mocked fetch. No real API key was read by the
development process, and no WebRTC model call, OpenAI charge, or Eazo Credit was used
while building the feature. Source release and the paid smoke test are separate,
explicitly approved steps; credentials are entered directly into Railway.

Local verification passed 340/340 tests (Contracts 24, Agent Core 166, Server 91,
Web 59), root typecheck, lint, production build, 17/17 fixed cases, and 359/359 fixed
checks. The production smoke command was run only in dry-run mode and made zero network
requests.

## Known limits

- The browser receives an ephemeral key and can be modified. Client turn gating and
  output guardrails are defense-in-depth for the shipped honest client, not a hard
  server enforcement boundary. Server sideband control or a server-owned chained voice
  architecture is required before claiming that a malicious client cannot bypass it.
- Browser timers and process-local leases do not forcibly terminate an established
  WebRTC call or coordinate multiple Railway replicas. OpenAI project spend and rate
  limits are the hard cost backstop for the competition demo, which must run with one
  Railway replica.
- The output guardrail can stop a response after a short spoken prefix; it cannot
  guarantee zero unsafe audio disclosure. The Realtime SDK adds a lazy browser chunk,
  so the production build reports a non-blocking chunk-size warning.

## Rollback

Set `VOICE_ENABLED=false`. The text, screenshot, model-selection, and MCP paths remain
unchanged, and the result page hides the voice entry when capabilities report disabled.
