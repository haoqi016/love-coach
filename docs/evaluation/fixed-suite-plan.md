# Fixed evaluation suite plan

## Goal

Create a versioned, deterministic evaluation suite that makes prompt and grounding changes measurable without spending model credits.

## Phases

- [x] Phase 1: Inspect current contracts, local provider, scripts, and repository constraints.
- [x] Phase 2: Define at least 12 synthetic fixtures with machine-checkable expectations.
- [x] Phase 3: Implement the zero-remote-call runner and JSON/Markdown reports.
- [x] Phase 4: Document the workflow and verify eval, lint, typecheck, and diff scope.

## Key questions

1. Can every fixture be evaluated without network access or provider credentials?
2. Can evidence citations be checked against the exact submitted conversation text?
3. Does a second local run produce byte-equivalent normalized guidance?

## Decisions

- Fixtures live under `evals/v1/cases/`; the directory name is the suite version.
- The default command uses only `LocalModelProvider` through `guideNextConversationDetailed`.
- Reports are written to `evals/reports/latest.json` and `evals/reports/latest.md`.
- Expectations test stable behavioral properties instead of fragile full-string snapshots.

## Errors encountered

- Initial eval stopped on the one-sided limited-data fixture because Agent Core rejected its advice-only summary and interaction evidence. The evidence implementation owner was notified; the runner was also changed to record generation failures per case instead of losing the full report.
- The first PowerShell parser check let the outer shell expand `$null`, producing a spurious `=` command error despite exit code 0. Re-ran with a single-quoted command and explicit parser-error exit; syntax passed.

## Status

**Complete** - 17/17 cases and 359/359 checks pass with zero remote calls; the production runner dry-run also confirms its three-call plan without network access.
