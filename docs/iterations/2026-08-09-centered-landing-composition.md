# Centered landing composition

Date: 2026-08-09

## Goal

Make the first screen feel genuinely centered and visually balanced while preserving the existing warm paper-letter identity and all product behavior.

## Audit finding

The outer 1080px container was already mathematically centered and every tested viewport had no horizontal overflow. The perceived imbalance came from two desktop rules:

- The hero/privacy columns were about 667px/359px, or 65/35.
- The grid stayed top-aligned at y=112 even on tall screens, so all extra height accumulated below the main content.

The fix therefore centers the composition rather than globally centering all text. Long-form copy stays left aligned for readability.

## Changes

- Rebalanced desktop columns to `1.15fr / 0.85fr`, producing approximately 584px/432px tracks at the 1080px maximum width.
- Used `align-content: center` for desktop and retained a larger bottom allowance, leaving the composition intentionally 44–54px above the viewport center.
- Removed the privacy letter's manual 30px top margin and vertically aligned both columns.
- Centered the 600–899px copy container at a 630px maximum width.
- Reduced the maximum desktop title size from 68px to 64px to keep its visual weight proportional to the wider privacy column.
- Added a restrained sage outline opposite the existing coral outline, slightly stronger card depth, and brighter paper-pill surfaces.
- Increased the shared brand subtitle and footer from 10px to 11px. This is the only intentional shared application-chrome change; workspace content remains untouched.

## Responsive evidence

| Viewport | Result |
|---|---|
| 375x812 | No overflow; two single-line title rows; two 325px full-width CTAs; centered privacy card. |
| 768x1024 | 630px copy container and privacy card share the same x=384 center. |
| 920x820 | Tight desktop breakpoint remains two columns with a 1px union-center error and no CTA/title overflow. |
| 1280x900 | 584px/432px tracks; visual union is 10px left and 44px above viewport center. |
| 1920x1080 | Visual union is 10px left and 54px above viewport center instead of more than 200px above center. |

The mobile upload step was also opened after the landing-page test. Its header, workspace, and footer remained 325px wide with no horizontal overflow.

## Verification

- Web unit tests: 31/31 passed.
- Web typecheck and lint: passed.
- Web production build: passed, 124 modules transformed.
- Browser console: 0 warnings/errors.
- `git diff --check`: passed.
- Independent diff review: no P0/P1 findings.
- Inference/model requests: 0.
- Credits used: 0.

## Scope and rollback

Application logic, upload/OCR, model selection, analysis, safety, REST, and MCP were unchanged. To roll back this iteration, revert the centered-layout CSS block and the small shared header/footer sizing adjustment; no backend or contract rollback is required.

## Production verification

- Commit `2c5d83d` reached private GitHub `main` and triggered Railway automatically.
- Railway deployment `49329ee5-0504-4f6f-99e6-a3289409a63d` became Online; `/health` returned `ok` for `@alc/server`.
- Production at 1280x900 returned the expected 584px/432px tracks, `align-content: center`, visual center x=630/y=406, two intentional title rows, and no horizontal overflow.
- Production at 375x812 retained two 325px full-width CTAs, two intentional title rows, and no horizontal overflow.
- The production browser console returned 0 warnings/errors. No analysis action was started, so deployment verification used 0 model Credits.
