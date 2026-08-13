# Iteration Records

Use one file per meaningful product iteration. The file name is `YYYY-MM-DD-short-topic.md`.

Each record must include:

1. **Goal** — the user or competition problem being addressed.
2. **Baseline** — the observable behavior before the change.
3. **Decision** — what changed and why this option was selected.
4. **Files changed** — exact source and documentation paths.
5. **Verification** — commands, test counts, fixtures, latency, and public checks.
6. **Credits** — model, request count, estimated or observed Credits, and whether raw private data was used.
7. **Risks and rollback** — known limits and the smallest reversal path.
8. **Next evidence** — the next test that could change the decision.

Recording layers:

- Git: exact code history and rollback.
- `CHANGELOG.md`: concise user-visible changes.
- `docs/iterations/`: rationale, evidence, failed attempts, and model-test accounting.
- `task_plan.md`: only the currently active execution status.

Create one iteration record for a coherent product decision, not for every small edit. After Git is initialized, add the commit hash and any Railway deployment ID to the record so source, evidence, and the deployed version can be traced together.

Never record private keys, raw personal chats, screenshots, account IDs, or identifying user data.
