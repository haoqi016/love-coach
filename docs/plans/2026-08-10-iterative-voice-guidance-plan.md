# Iterative voice-guidance implementation plan

## Goal

Change voice refinement from optional transcript-note collection into a repeatable draft-focused loop:

`initial guidance -> select one draft -> Realtime discussion -> end and regenerate -> select again if needed`

## P0 implementation

- Require a draft selection before starting the microphone.
- Put the selected draft in the server-built Realtime context as bounded data.
- Keep deterministic turn-safety checks before every Realtime response.
- Replace the manual per-turn confirmation wall with an explicit “end and generate final advice” action.
- Convert the completed user turns into bounded refinement context and run the existing Prompt v4 guidance pipeline.
- Never present deterministic local fallback as a voice-informed result when it did not consume the voice context.
- Read the refreshed voice-context token after refinement and make the new result eligible for another round.
- Preserve the old result when session creation or final regeneration fails.

## End-of-session semantics

- Manual end is a single-flight action. It is disabled while transcription or turn safety is unresolved.
- Ending while the coach is thinking or speaking cancels that response, closes the media session, and refines only from user turns that already completed transcription and safety review.
- The five-minute timeout uses the same single-flight finalizer. It discards any incomplete/partial turn and regenerates only when at least one safe completed user turn exists.
- Closing the sheet, pressing Escape, or navigating away only cleans up; it does not trigger paid refinement.
- The consent copy and final button explicitly state that ending authorizes use of this round's completed transcription. `confirmed: true` records that round-level authorization; it does not claim word-for-word ASR review.

## Repeat and trust boundaries

- Repeated rounds reuse one internal refinement marker. Existing voice notes are deduplicated, the latest selected draft replaces the older selected draft, and original user context remains unchanged.
- A failed later round leaves the previously successful guidance, token, and request intact.
- The selected draft may contain user edits. It is treated as bounded, untrusted user data, checked by deterministic text/output safety, and embedded only inside the server-delimited data context. It is never chat evidence or a system instruction.

## Verification

- Contracts: selected draft is required and bounded for both session creation and final refinement.
- Server: selected draft enters Realtime instructions; unsafe draft is rejected; refinement failure does not masquerade as success.
- Web: draft must be selected before start; ending generates automatically; refreshed result/token/request can start another round.
- Full zero-remote test, typecheck, lint, build, fixed evaluation, secret scan, and diff review.
- Push only after all required checks pass; production verification uses GET/health/UI only unless a paid test is separately authorized.

## Out of scope

- Persisting raw audio or full transcripts.
- Automatic message sending.
- MCP audio streaming.
- Removing the existing per-turn safety gate.
