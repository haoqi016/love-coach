# Cross-platform typography refinement — 2026-08-10

## Goal

Modernize the Chinese interface after user feedback that the broad Songti treatment felt dated, without replacing the existing warm paper-letter visual identity.

## Baseline evidence

- `var(--serif)` appeared 44 times across `styles.css` and `voice.css`.
- The named serif stack (`Iowan Old Style`, `Baskerville`, `Songti SC`, `STSong`) had no exact registered match on the tested Windows system.
- High-frequency reading and interaction surfaces inherited serif styling: transcript editing, model selection, message drafting, voice consent, live subtitles, and voice-note editing.
- Production responsive measurements had no layout failure, but explanatory text reached 8–10px and inactive progress text measured too lightly against the paper background.

## Implementation

- Added one local-first `--sans` stack and a `--display` alias. The root document now uses that stack.
- Removed explicit Songti/STSong dependencies.
- Moved Chinese branding, headings, labels, controls, editable text, result content, footer, and voice UI to `--display` or `--sans`.
- After the user's screenshot review, removed the decorative serif exception too. English stamp typography, ordinal numbers, arrows, and small symbols now use the sans stack.
- Final CSS contains no `--serif`, `var(--serif)`, `Songti`, `STSong`, or generic `serif` font-family reference.
- Rebalanced title weights and spacing for modern sans metrics.
- Raised important small copy to 11–12px and darkened inactive progress text.
- Added no external fonts and changed no React component, API, model, safety, OCR, or persistence behavior.

## Verification

### Automated

- `pnpm --filter @alc/web test`: 59/59 passed.
- `pnpm --filter @alc/web typecheck`: passed.
- `pnpm --filter @alc/web lint`: passed.
- `pnpm --filter @alc/web build`: passed.
- `git diff --check`: passed.

The existing Realtime SDK lazy chunk remains 617.83 kB and produces the same non-blocking Vite size warning.

### Browser

The built production assets were served only on `127.0.0.1` and inspected without submitting analysis:

| Viewport | Result |
| --- | --- |
| 375x812 | No horizontal overflow; hero remains two deliberate lines; both CTAs remain 52px high; upload H1 is 30px and upload guidance is 16px. |
| 768x1024 | No horizontal overflow; hero reaches 56px; buttons retain their intended desktop widths. |
| 900x900 | Tight two-column breakpoint remains stable at 448px/340px with no overflow. |
| 1280x900 | No horizontal overflow; hero is 61.44px and the centered 584px/394px composition remains balanced. |

Computed body, hero, workflow heading, upload label, and buttons all resolved to the new local-first sans stack.

After the strict no-serif follow-up, the 1280px “你的意图” page was opened through the local fictional sample flow. Its H1 resolved to 46px/600, group legends to 20px/600, choice titles to 14px/600, and choice descriptions to 11px/400; all reported the local-first sans stack and the page had no horizontal overflow.

The landing headline then received a separate restraint pass after the user found the new 600-weight sans treatment too heavy. Only `.welcome h1` changed: weight 500, 34–52px below the desktop breakpoint, 52–58px at desktop, 1.12 line height, and `-0.012em` tracking. Workflow and result headings retain their existing hierarchy.

## Cost and privacy

- Remote model calls: 0.
- Credits used: 0.
- No user chat, screenshot, microphone, key, or credential entered the verification flow.
- No webfont request or new third-party origin was introduced.

## Rollback

Revert the typography changes in `apps/web/src/styles.css` and `apps/web/src/voice/voice.css`. Documentation can be reverted independently. Provider, MCP, OCR, safety, and contract code are unaffected.
