# 教恋 landing-page refinement

Date: 2026-08-09

## Goal

Introduce “教恋 · A Little Closer” as the product brand and make the first screen easier to understand and act on without replacing the existing warm paper-letter visual identity or changing any analysis behavior.

## Scope

- Brand and browser metadata.
- Hero hierarchy, fixed two-line title, CTA wording, and three feature tags.
- Desktop vertical spacing and privacy-card density.
- Muted-text contrast, small-copy sizing, mobile button width, and restrained motion.

Provider routing, model selection, MCP, OCR, safety, storage, privacy consent, Agent prompts, output contracts, and result logic were unchanged.

## Design decisions

- Use `教恋` as the memorable Chinese wordmark and retain `A Little Closer` for continuity.
- Use “你的专属恋爱沟通教练” as the primary promise.
- Name the initial persona as “不擅长表达的工科男生” without using “直男” as a permanent label; explicitly keep the product open to everyone who wants to communicate more clearly.
- Preserve the editorial Chinese serif, coral/sage/paper palette, visible borders, and letter-card motif. Do not introduce glassmorphism, purple gradients, illustration-heavy decoration, or continuous animation.
- Scope button sizing and layout rules to the welcome screen so later steps retain their existing component behavior.

## Observable before/after

At the normal 1367x756 Chrome viewport:

- Hero title height: 253px → 147px.
- Hero title top: y=174 → y=138.
- CTA row top: y=542 → y=442.
- Privacy-card top: y=197 → y=140.
- Both intended title lines now report exactly one rendered client rect.

At 375x812:

- Content column: 325px with no horizontal overflow.
- Title-line widths: 186px and 298px, each one client rect.
- Both CTA buttons: 325px full width.
- Privacy card follows the main copy at y=671 instead of competing beside it.

The same single-line title checks passed at 768x1024 and 1280x900. Muted text is `#475d55`, measuring 6.04:1 against the main `#f4ecdf` paper background and 6.82:1 against the light card background.

## Verification

- Web: 31/31 tests, typecheck, lint, and production build passed.
- Full workspace: 199/199 tests, typecheck, lint, and production build passed.
- Browser DOM and responsive checks passed at 375, 768, 1280, and 1367 widths; the local console returned 0 warnings/errors.
- The mobile upload flow remained usable and did not overflow.
- Verification made 0 inference requests and used 0 model Credits.

## Rollback

Revert the landing copy/markup and its welcome-specific CSS, then restore the previous document title, PWA manifest, and icon accessibility label. No backend or shared contract rollback is required.

## Production verification

- Commit `bad3d4c` reached private GitHub `main` and triggered the existing Railway GitHub deployment automatically.
- Railway deployment `d0941562-a2b4-4ffc-8422-ee4d8094f86a` became Online; `/health` returned `ok` for `@alc/server`.
- Production Chrome at 1367px returned the new title and brand, both intended title lines as one client rect each, all three feature tags, both new CTA labels, and equal document/viewport widths.
- Production at 375x812 retained the measured 186px/298px title lines, two 325px full-width CTA buttons, and a 329px privacy card without horizontal overflow.
- Verification did not click the analysis action and made 0 inference requests, so it used 0 model Credits.
