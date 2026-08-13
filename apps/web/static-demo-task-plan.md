# Task Plan: Static Eazo demo build

## Goal
Allow `VITE_STATIC_DEMO=true` to produce a browser-only demo that reuses the existing local Agent Core provider, while preserving the default REST-backed behavior.

## Phases
- [x] Phase 1: Define scope and verification targets
- [x] Phase 2: Inspect the web client, Agent Core exports, and workspace build setup
- [x] Phase 3: Implement static guidance and screenshot fallback paths with focused tests
- [ ] Phase 4: Run typecheck, tests, and both static/default builds
- [ ] Phase 5: Review the diff and report exact changes and remaining limits

## Decisions Made
- Keep REST as the default path; enable browser-only behavior only for the exact build flag `VITE_STATIC_DEMO=true`.
- Do not modify server or Agent Core source; consume its existing public browser-safe API from the web package.
- Dynamically import Agent Core only inside the static branch so the default production bundle can remain REST-only.

## Errors Encountered
- `pnpm install --offline --frozen-lockfile` stopped because pnpm wanted an interactive confirmation before refreshing `node_modules`; retry with the non-interactive `confirmModulesPurge=false` config override.
- The full-workspace offline retry timed out after 120 seconds while recreating root `node_modules`; no process remained. Narrow the install to `@alc/web` and its workspace dependencies before verification.

## Status
**Currently in Phase 4** - installing the workspace link and running focused verification plus both build modes.

---

## Static ZIP Packaging Extension (2026-08-09)

### Goal
Package the already-built static `dist` contents at the ZIP root for Eazo import, without rebuilding or including source/dependencies.

### Phases
- [x] Inspect `dist` structure and static-mode markers
- [x] Create the canonical archive and byte-identical short alias
- [x] Verify entry paths, asset references, excluded content, hashes, and sizes

### Decision
- The existing `dist` qualifies as a static build: its main bundle contains the manual screenshot fallback, its lazy chunk contains `deterministic-local`, and no JavaScript bundle contains `/api/guidance` or `/api/extract`.

### Status
**Packaging complete** - both ZIP paths contain the same verified 101,502-byte archive.
