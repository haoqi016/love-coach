# Notes: Static Eazo demo build

## Scope
- Owned source: `apps/web`.
- Allowed only if required: root dependency metadata and lockfile.
- Must preserve the existing REST/MCP production behavior when the static flag is absent.

## Findings
- `apps/web/src/api.ts` previously routed both operations directly to `/api/*`.
- `@alc/agent-core` exports `guideNextConversation` and `LocalModelProvider`; both use Web-compatible TypeScript/JavaScript and no Node-only runtime API.
- Static screenshot processing now returns an empty transcript with `requiresManualReview: true`; the UI tells the user before and after continuing that the image is not uploaded or recognized.
- The default branch is unchanged and still calls `/api/extract` and `/api/guidance`.

## 2026-08-09 Existing Dist Inspection
- Root entries present: `index.html`, `assets/`, `manifest.webmanifest`, `sw.js`, `icon.svg`.
- Build output has seven files: one HTML, one CSS, two JavaScript bundles, manifest, service worker, and icon.
- Main bundle contains the explicit static screenshot fallback.
- Lazy Agent Core chunk contains `deterministic-local`.
- Neither JavaScript bundle contains `/api/guidance`, `/api/extract`, or `VITE_STATIC_DEMO`.
- Per task constraint, no build command was run.

## 2026-08-09 Static ZIP Verification
- Canonical archive: `C:\Users\37103\Desktop\fyj\eazo_hackathon_research\artifacts\a-little-closer-eazo-static-20260809.zip`.
- Short alias: `C:\Users\37103\Desktop\fyj\alc-eazo-static.zip`.
- Both files: 101,502 bytes; SHA-256 `CA9B4D7BC3125B7EF0BB81993C75150B96D62E53913A5328CA372F599899BB0A`.
- Seven file entries, 314,282 uncompressed bytes; ZIP root has no wrapper directory.
- Required root files and all four `index.html` references are present.
- Each archived file hash matches its `dist` source.
- No source path, `node_modules`, `.env`, package/lock file, source map, private-key marker, API-key marker, or `sk-` token pattern was found.
