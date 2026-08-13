# Iterative voice-guidance notes

## Resolved implementation gaps

- [x] Draft selection now appears before microphone access and is required.
- [x] Realtime session creation receives the frozen selected draft after server-side safety validation.
- [x] Manual end and the five-minute timeout run one bounded finalizer that regenerates guidance from safe completed user turns.
- [x] Successful refinement keeps the voice entry available and atomically adopts the refreshed request and signed token.
- [x] Voice refinement disables deterministic local fallback, so a provider failure cannot masquerade as a voice-informed update.

## Decisions

- The selected draft is required before microphone access and frozen for that voice round.
- The visible live surface remains a conversation; transcript processing stays in the background.
- Clicking the final end action explicitly authorizes use of that round's completed transcripts for regeneration.
- The authoritative result remains the normal Prompt v4 `GuidanceOutput`; Realtime does not replace evidence or safety validation.
- A failed regeneration leaves the previous result unchanged.
- Manual end is disabled during unresolved transcription/safety. During thinking or speaking it cancels the pending coach response, then uses only already safety-approved user turns.
- The five-minute timeout follows the same one-shot finalizer; partial ASR is discarded, and zero safe turns produce no model request.
- Escape/close/pagehide clean up without regeneration.
- Repeated rounds keep one internal marker, deduplicate bounded notes, replace the previous selected-draft line, and preserve the base user context.
- A selected draft is user-editable, bounded and safety-checked data. It is not trusted chat evidence and cannot supply quote evidence.
- Public user context remains capped at 2,000 characters; the internal validated request budget is 5,000 characters so bounded voice metadata does not displace the user's original context.
- Versioned start/end sentinels provide a canonical serialization boundary, not authentication. Public context rejects the reserved sentinels, and refinement accepts at most one complete terminal block.
- Historical and current-round notes are labelled separately; an explicit current correction takes priority over conflicting earlier ASR.
