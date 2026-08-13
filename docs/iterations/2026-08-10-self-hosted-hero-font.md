# Self-hosted landing headline font — 2026-08-10

## Goal

Give the fixed landing headline the same warm editorial character on Windows, macOS, iOS, and Android without changing the typography of forms, analysis results, or generated text.

## Decision

- Use `lxgw-wenkai-webfont@1.7.0`, which packages the LXGW WenKai font under SIL OFL 1.1 and its Webfont wrapper under MIT.
- Import only the regular 400-weight CSS.
- Apply it only to `.welcome h1`; retain the existing local-first sans stack everywhere else.
- Bundle the WOFF2 resources into the Vite production output and serve them from the Railway application origin. Do not use a font CDN.
- Restrict the production Content Security Policy to `font-src 'self'` so future font loading cannot silently switch to an external host.
- Keep the system sans stack as the immediate fallback while `font-display: swap` loads the self-hosted face.

## Implementation

- `apps/web/src/main.tsx` imports `lxgwwenkai-regular.css` before the application stylesheet.
- `apps/web/src/styles.css` defines `--hero-display: "LXGW WenKai", var(--sans)` and uses it only for the welcome H1.
- The headline uses weight 400, a 1.16 line height, and slight positive tracking to preserve the open handwritten shapes.
- `apps/web/public/licenses/` publishes the complete OFL and MIT license text with the built site.
- `apps/web/package.json` and `pnpm-lock.yaml` pin the package to 1.7.0 with an integrity hash.

## Performance boundary

The official Webfont package is split by Unicode range. Vite emits 97 regular WOFF2 subsets totaling about 4.42 MB into the deploy artifact, but the tested headline loads only five subsets totaling 229.35 KB. The generated CSS is 129.20 KB uncompressed and 40.87 KB gzip. No third-party runtime request is made.

The font remains limited to the fixed brand headline. Applying it to arbitrary model output would cause additional subsets to load and make layout width less predictable, so that expansion is intentionally excluded.

## Verification

- Web unit tests: 59/59 passed.
- Web typecheck: passed.
- Web lint: passed.
- Web production build: passed.
- License copies match the installed package after whitespace normalization.
- Browser at 1280x900: `LXGW WenKai` loaded, 55.04px/400, both intended lines have one client rect, and no horizontal overflow.
- Browser at 375x812: `LXGW WenKai` loaded, 35.29px/400, both intended lines have one client rect, both calls to action remain 325px wide, and no horizontal overflow.
- Browser console warnings/errors: 0.
- Model/API calls: 0. Credits used: 0.

## Rollback

Remove the Webfont import and dependency, change `.welcome h1` back to `var(--sans)` at weight 500, remove the two published license files, and regenerate the lockfile. Provider, voice, MCP, OCR, safety, and data contracts are unaffected.
