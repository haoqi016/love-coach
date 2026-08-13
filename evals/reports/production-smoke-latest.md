# Production path smoke report

- Base URL: `https://web-production-fb777.up.railway.app`
- Tested commit: `b4f8da402cc5ea03e29f6936d01e7dc414fa9f0f`
- Runtime deployment: `ab9d24df-0c9b-432f-ae36-5acc448217f4`
- Report mode: consolidated from the successful `text` batch and the later `screenshot,mcp` batch; the runner normally overwrites `latest` on each execution
- Successful validation: **3/3 paths passed** in two fail-fast batches
- Successful-run business requests: **3**
- Earlier diagnostic business requests: **1**

| Path | Result | Details |
|---|---:|---|
| REST text | PASS | 14,793 ms; `remote`; `openai-compatible:gpt-4.1-mini-2025-04-14`; `guidance-v3`; request `36916a57-a621-478b-9a8c-8de878f63440` |
| Screenshot OCR | PASS | 4,341 ms; 4 labelled lines; 10 expected fragments; manual review required; request `146c4e91-a1eb-46a5-b5b6-77efd36dd434` |
| MCP | PASS | 27,637 ms; one tool listed; structured/text outputs matched; `remote`; `eazo-app-ai:deepseek.v3.2`; `guidance-v3` |

## Diagnostic history

The first Prompt v3 text attempt used `deepseek-v3.2` and reached the 30-second service budget. It returned the valid deterministic fallback after 30,485 ms, so the smoke correctly failed the remote-provenance requirement and stopped before screenshot or MCP. Railway logged the sanitized error code `overall_timeout`.

The event gateway `/models` metadata endpoint then confirmed `gpt-4.1-mini-2025-04-14`. Railway switched only the non-secret `TEXT_MODEL_NAME`, deployed successfully, and the bounded text retry passed in 14,793 ms. Screenshot and MCP were executed only after that pass.

## Cost and interpretation boundary

The successful validation used three business requests. The earlier failed text diagnostic makes four business requests in this production session. A business request can make multiple upstream attempts: the accepted MCP result came from the Eazo fallback, so its upstream-attempt count may exceed one. This report is not a provider billing ledger and does not claim an exact USD or Eazo Credit charge.

All fixtures were synthetic. The report stores no credentials, raw chat transcript, screenshot, or raw model output.
