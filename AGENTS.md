# Project Agent Instructions

These instructions apply to the entire `a-little-closer` repository.

## Application changes

- Make application changes directly in this repository through Codex, then run the smallest relevant local verification before deployment.
- Do not use Eazo Creator chat, app generation, or App build actions to modify, regenerate, restyle, repair, or redeploy the application unless the user explicitly asks for that exact Eazo action.
- Preserve the existing local deterministic provider and manual screenshot-entry path as fallbacks. A remote model failure must not make the competition demo unusable.
- Do not expand the competition scope to realtime voice, accounts, long-term memory, or automatic message sending unless the user explicitly requests it.

## Verified deployment workflow

- After a requested application change passes its smallest relevant local verification, commit it with a Conventional Commit and push the private GitHub `main` branch by default. The connected Railway service should then deploy automatically.
- Do not auto-push when the user says “先别推”, “仅本地”, or otherwise requests a review checkpoint before publication.
- Do not push failing, partially verified, credential-bearing, or unrelated user changes. Stop and report the exact blocker instead.
- After each push, confirm that local `HEAD` matches `origin/main`, the Railway deployment corresponds to that commit and reaches `SUCCESS`, `/health` returns 200, and the changed production surface behaves as expected.
- Production verification must avoid paid model calls unless the user separately authorizes a bounded inference test.

## Eazo Credits budget

- Reserve Eazo Credits exclusively for controlled Eazo model API testing and final end-to-end inference verification.
- Allowed uses include text-model smoke tests, screenshot/OCR tests, structured-output validation, safety fixtures, latency checks, and a final pre-submission connectivity test.
- Do not spend Eazo Credits on Creator App builds, broad exploratory prompting, unrelated conversations, voice experiments, load/stress testing, or public production traffic unless the user explicitly approves that use.
- Before a credit-consuming test, run local lint/typecheck/unit/build checks that can catch the same failure without model calls.
- Define the model, fixtures, expected call count, and pass criteria before calling the API. Keep prompts, image count, and maximum output tokens as small as the test permits.
- Without fresh user approval, limit one paid test run to at most 20 model requests and an estimated 5 Credits. Stop early when the pass/fail decision is already clear.
- Allow at most one automatic retry per failed paid request. Do not hide Eazo failures behind the local fallback during the dedicated connectivity test.
- Record request count, model name, success/failure, latency, and approximate Credits used. Do not record raw private chats or screenshots.

## OpenAI Next event credits

- Treat the Eazo Global Youth event allocation at `api.openai-next.com` as a temporary third-party multi-model gateway, not as an OpenAI account balance or a permanent production dependency.
- Keep the integration OpenAI-compatible and environment-driven. Do not hardcode the gateway hostname, API key, or model name in application source.
- During the event, prefer the ordered runtime fallback `OpenAI-compatible provider -> Eazo App AI -> deterministic local/manual fallback`.
- The event page displayed an API-key expiry of `2026-08-11 00:00` without a timezone. Do not rely on the event key after that boundary; switch the primary Provider back to Eazo or another approved service.
- Store the event API key only in server-side environment variables. Never read it into browser code, commit it, echo it to logs, paste it into task messages, or include it in screenshots or submission files.
- Use separate low-cap keys for local verification and Railway when practical. Keep the public service rate, concurrency, and daily-attempt guards active for every remote Provider, not only Eazo.
- The same paid-test discipline applies to event credits: local checks first, synthetic or de-identified fixtures, explicit call counts and pass criteria, at most one retry, and no load testing without fresh approval.

## Eazo integration and data safety

- Keep `EAZO_PRIVATE_KEY` and all provider credentials only in server-side environment variables such as Railway Variables. Never place them in browser code, committed files, screenshots, logs, or submission ZIPs.
- For viewer-facing Eazo App AI, use the documented server-side App AI billing proxy. Do not expose arbitrary `model_key` selection to the browser.
- Use synthetic or de-identified chat fixtures by default. Remove names, avatars, account IDs, phone numbers, locations, and other third-party identifiers from screenshots before upload.
- Do not purchase, recharge, enable auto-recharge, or change a subscription automatically. Report a `402`, exhausted balance, missing credential, or billing blocker to the user.

## Competition model defaults

- Text candidate: `deepseek.v3.2`; compare with `zai.glm-5` only when a bounded test has a clear decision criterion.
- Screenshot/OCR candidate: `qwen.qwen3-vl-235b-a22b-instruct`; compare with `moonshotai.kimi-k2.5` only on a small de-identified fixture set.
- Validate every remote response against the shared contracts and safety checks before showing it to the user or returning it through MCP.
- OpenAI-compatible text candidates for a bounded comparison are `claude-sonnet-4-6`, `gpt-5.6-terra`, and `deepseek-v3.2`; do not claim a winner before the same de-identified fixtures are measured.
- OpenAI-compatible screenshot candidate is `qwen3-vl-plus`; its `image_url` compatibility must pass one controlled test before it replaces the Eazo vision path in a public demo.
