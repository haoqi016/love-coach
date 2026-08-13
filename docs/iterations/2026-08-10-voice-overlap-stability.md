# Voice overlap stability — 2026-08-10

## Outcome

The Realtime voice coach no longer disconnects merely because a late speech boundary or a short echo arrives while the previous turn is being transcribed or safety-checked. Genuine unreviewed overlap remains fail-closed.

## Root cause

- `speech_started` previously caused an immediate disconnect whenever the turn gate was closed.
- The error path reset the reducer before showing the error, so the remaining-time display jumped back to `05:00`.
- Realtime event ordering can deliver late boundaries, transcription events, and deletion acknowledgements out of order.

## Changes

- Carry Realtime `item_id` through speech, transcription, and deletion events.
- Keep the microphone muted while a turn is transcribed, checked, or waiting for a response.
- Delete distinct gate-time items and wait for every deletion acknowledgement before issuing one `response.create`.
- Treat duplicate deletion acknowledgements as idempotent; reject unknown acknowledgements.
- Fail closed after 10 seconds without a transcription terminal event or 4 seconds without a deletion acknowledgement.
- Preserve the remaining time and confirmed notes when a genuine voice error occurs.
- Use low-eagerness semantic VAD in both the server-minted session and browser session update.

## Verification

- Web: 67/67 tests, typecheck, lint, and production build passed.
- Server: 91/91 tests, typecheck, lint, and build passed.
- Two independent read-only race and safety reviews found no remaining P0/P1 issue in this change.
- Real model and network calls during verification: 0.

## Boundary

The browser WebRTC gate remains a best-effort control for the competition MVP. A malicious modified client cannot be fully constrained without server-side Realtime sideband control.

## Rollback

Revert the commit containing this iteration. No contract, database, secret, or migration change is required.
