# Strategy-differentiated guidance

## Goal

Make relationship stage, conversation goal, and preferred tone affect the
actual guidance rather than behaving mainly as output labels.

## Root cause

The Web already submitted all three selections, but both remote Providers used
one shared Prompt with only the raw input and deterministic risk result. Runtime
validation checked the first draft's style enum, not whether its language or
next step reflected the selected strategy. The local fallback varied some goals
but reused generic wording across most tones and limited-data cases.

## Change

- Added one exhaustive, server-owned strategy map with 18 independent modules:
  6 relationship stages, 7 conversation goals, and 5 tone policies.
- Prompt v4 sends only the three selected policies to both remote Providers.
- Fixed priority at `safety/evidence > stage > goal > tone`; selections may
  change depth, direction, bridges, and wording, but cannot rewrite facts,
  evidence, or the authoritative risk decision.
- Reworked deterministic local guidance so seven goals produce different first
  drafts, bridges, and next steps; five tones produce different text; and six
  stages produce different rationales and next-step pacing.
- Added a post-generation check that rejects remote guidance whose recommended
  depth exceeds the selected stage.
- Kept the REST body, MCP input/output schema, MCP tool name, and Web request
  contract unchanged.

## Safety boundaries

- `after_conflict` pauses incompatible invitation or intimacy progression.
- Playful wording cannot joke about conflict, rejection, safety, or a boundary.
- Existing evidence-substring checks, deterministic risk matching, output
  safety scanning, and local fallback behavior remain in force.

## Verification

- Agent Core: 179/179 unit tests passed, including exhaustive policy coverage,
  seven-goal differentiation, five-tone text differentiation, six-stage output
  differentiation, conflict priority, and remote depth rejection.
- Server: 91/91 tests passed after Prompt-version propagation.
- Fixed evaluation: 17/17 cases and 359/359 checks passed with 0 remote calls.
- Agent Core and Server typecheck, lint, and production build passed.

## Cost and deployment state

No remote model request was made and 0 Credits were used. No Railway variables
or deployment were changed. Production will continue to report Prompt v3 until
this code is committed, pushed, and the GitHub-connected Railway service finishes
deploying Prompt v4.

## Rollback boundary

Revert the Prompt v4 serialization, strategy profile module, local strategy
wording, corresponding tests, and current-version documentation together. Do
not revert unrelated voice or screenshot work already present in the shared
working tree.
