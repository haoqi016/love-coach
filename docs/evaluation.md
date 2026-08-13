# Evaluation plan

## Automated quality gates

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Contract coverage

- Valid conversation with all relationship stages and goals.
- Missing, empty, and oversized conversation text.
- Sparse or one-sided interaction.
- Manipulation, stalking, coercion, and explicit rejection.
- Self-harm, harm to others, and violence escalation.
- Malformed, oversized, and unsupported screenshot files.
- REST and MCP responses conform to the same output schema.

## Connectivity

- `/health` returns a small JSON response without provider access.
- `/api/guidance` works with the deterministic development provider.
- `/mcp` lists and calls one `guide_next_conversation` tool.
- The public endpoint is tested without a logged-in browser session.

## Performance targets

These are internal targets, not organizer-published thresholds:

- 30/30 successful warm MCP calls.
- Warm P95 at or below 12 seconds with a hosted model.
- Cold start at or below 20 seconds.
- No unbounded retries; at most one provider retry for transient failure.

## Human test

For the competition MVP, one consenting adult target user completes one de-identified past example and one synthetic example. Measure whether they can finish without assistance, whether the suggested message sounds like them, whether the next step is clear, and whether the advice respects the other person's autonomy.
