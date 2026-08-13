# Safety and privacy boundary

## Product promise

A Little Closer helps a user notice observable conversation patterns and choose a respectful next step. It does not infer another person's private mental state, calculate attraction, guarantee a romantic outcome, diagnose anyone, or send messages.

## Allowed guidance

- Continue a mutually engaged topic.
- Use proportionate self-disclosure followed by an open question.
- Offer a low-pressure invitation that is easy to decline.
- Pause when replies are absent, minimal, or explicitly rejecting.
- Preserve the user's own voice and decision-making.

## Prohibited guidance

- PUA, jealousy tests, love bombing, deception, impersonation, monitoring, or stalking.
- Circumventing a clear rejection or encouraging repeated unwanted contact.
- Threats, coercion, sexual pressure, or dependency language.
- Diagnosing a partner or presenting speculation as fact.
- Attraction scores, success probabilities, or promises of a relationship.

## Risk levels

- `low`: ordinary conversation guidance with an explicit uncertainty reminder.
- `caution`: show privacy or lower-severity safety warnings while keeping advice bounded.
- `high`: stop dating tactics when there is abuse, coercion, harassment, stalking, or sexual pressure.
- `crisis`: stop the normal flow for self-harm or violence signals and direct the user to local emergency help and trusted people. The product must state that it cannot contact emergency services.

## Screenshot handling

- Accept only bounded JPG/PNG inputs.
- Process the file in memory and do not inspect, log, or persist image metadata.
- Require the user to review extracted text before agent analysis.
- Ask users to crop or mask names, avatars, phone numbers, handles, addresses, and other third-party identifiers.
- Delete request buffers on completion or failure; never persist screenshots by default.
- Disclose any external model provider that receives image or text content before public use.

## Realtime voice handling

- Voice refinement is available only after a validated `low` or privacy-only `caution` guidance result and an explicit 18+ confirmation.
- The browser receives an approximately 10-second Realtime client secret only after microphone permission and SDK preload; the standard OpenAI API Key remains server-only and is restricted to the official OpenAI API origin. Raw audio is sent directly to OpenAI over WebRTC and is not proxied or persisted by this application.
- Disable automatic Realtime replies. The required order is completed input transcription → active-lease validation → deterministic turn safety → explicit `response.create` only when allowed. A missing, malformed, duplicated, out-of-order, or failed transcription stops the ordinary voice flow.
- Close the local turn gate synchronously at `speech_stopped`; delayed interruption or response-completion events must not reopen the microphone while transcription or safety review is pending. Generated audio transcripts are screened incrementally with the same deterministic prohibited-advice rules and a tripwire stops the honest client.
- Keep the microphone available while allowed assistant audio plays so the user can interrupt. Mute only while a completed user turn is awaiting the safety decision.
- High/crisis turns stop ordinary dating coaching, cancel/close the voice session, clear unconfirmed transcript state, and display deterministic safety language. The Realtime model must not improvise or suppress escalation.
- The browser turn gate and output tripwire are defense-in-depth, not a trusted enforcement boundary against a modified client holding an ephemeral key. Public-scale release requires server sideband control of responses or a server-owned STT → checked text → TTS path, plus provider-side spend/rate limits.
- Keep raw audio, complete transcripts, short-lived tokens, and lease identifiers out of local storage, service-worker caches, analytics, and ordinary logs. Session text exists only in React memory until the user closes the sheet or explicitly confirms bounded refinement notes.
- Confirmed notes describe the user's own context. They are appended to `context`, never to `conversationText`, and cannot satisfy quoted-evidence checks about the other person.
- The five-minute UI timer and in-process lease are not hard cross-instance billing or termination controls. Keep the competition deployment at one Railway replica and configure provider-side spend/rate limits before enabling the public feature.
