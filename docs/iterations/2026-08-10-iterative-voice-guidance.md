# Iterative draft-focused voice guidance

## Product decision

The voice feature now begins from one suggestion the user has already chosen. Realtime is a discussion and rehearsal layer around that draft; Prompt v4 remains the only source of the authoritative structured result.

```text
current guidance
  -> select and freeze one draft
  -> Realtime discussion with per-turn safety checks
  -> explicit end or five-minute timeout
  -> completed safe user transcripts
  -> Prompt v4 refinement
  -> revised guidance + fresh signed token
  -> optional next round
```

## Implementation boundaries

- `selectedDraft` is required for both `/api/voice/session` and `/api/voice/refine`, limited to 600 single-line characters, and checked as untrusted data.
- The Realtime prompt can clarify or rehearse the selected draft, but it cannot replace the evidence-bound Prompt v4 result.
- Manual end is disabled while transcription or turn safety is unresolved. Ending during a pending or active coach response cancels that response and uses only already approved user turns.
- Manual end and timeout use the same single-flight finalizer. The eighth bounded note finalizes immediately; longer ASR is split without loss and rejected visibly if it cannot fit the eight-note contract.
- Close, Escape, pagehide, permission failure, or connection failure clean up without generating a new result.
- Refinement success atomically updates guidance, provenance, drafts, merged request, and the fresh voice-context token. A later failed round preserves the last successful result.

## Multi-round context

- The public user context input remains capped at 2,000 characters.
- Canonically serialized voice metadata uses the validated 5,000-character internal request budget. The serialization boundary is not an authentication mechanism.
- A versioned start/end sentinel pair identifies exactly one terminal internal voice block. Public context cannot contain the reserved sentinels, and malformed or duplicate blocks are rejected.
- Historical and current-round notes are labelled separately. Explicit corrections remain marked in later rounds, so a correction such as “刚才听错了，不是周六，是周日” continues to outrank conflicting earlier ASR.
- Voice notes and selected drafts are context only. Exact `quote` evidence still has to be a substring of the original `conversationText`.

## Failure policy

`/api/voice/refine` disables deterministic local fallback. If no remote provider is configured, the provider times out, or the structured response fails validation, the route returns a sanitized error and the Web client keeps the previous guidance. This avoids claiming that a result was updated from speech when the fallback did not consume it.

## Verification record

- Contracts: 34/34
- Agent Core: 183/183
- Server: 102/102
- Web: 89/89
- Total: 408/408 workspace tests
- Typecheck, lint, production build, `git diff --check`, fixed evaluation 17/17 (359/359 checks), and production-smoke dry run passed.
- Local no-credit UI check: the voice entry was disabled before draft selection and enabled after selection; at the mobile viewport the card stayed within the page with no horizontal overflow; browser console warnings/errors were 0. A fresh production server build returned `ok`, voice enabled, a 300-second limit, and the current Web bundle.
- Network/model calls: 0
