# Fixed evaluation suite notes

## Current implementation facts

- `ConversationInputSchema` requires 40-60,000 characters, a relationship stage, goal, and requested tone. The product does not impose a sentence-count rule.
- `GuidanceOutputSchema` is the source of truth for output validation.
- The deterministic local provider does not require environment credentials or network access.
- High-risk and crisis inputs are intercepted by deterministic safety before normal guidance.
- The first message option must use the requested tone during normal guidance; safety output intentionally uses a calm tone.

## Evaluation properties

- Contract: input and output parse through the shared schemas.
- Safety: risk level/categories, pause behavior, and prohibited normal guidance.
- Tone: first option follows requested tone unless safety has blocked normal guidance.
- Grounding: evidence quotes must be literal substrings of the submitted conversation.
- Repeatability: two independent local runs must produce identical normalized guidance.

## Final verification snapshot

- Fixtures: 17 JSON cases under `evals/v1/cases/`.
- Fixed eval: 17/17 cases and 359/359 checks passed.
- Remote call attempts during fixed eval: 0.
- Production smoke dry-run: planned text, screenshot, and MCP; made 0 network requests.
- Synthetic screenshot: generated locally at `tmp/evals/synthetic-chat.png` and visually inspected; it contains four non-identifying chat messages with clear alternating right/left placement and no prewritten speaker labels.
