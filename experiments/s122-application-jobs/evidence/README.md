# Evidence snapshots

Captured `2026-09-10T09:54:59Z` from official free JSON (and two rejected
GitHub release endpoints). Working recipe I/O lives under `../fixtures/`.

| File | Source | Used by |
| --- | --- | --- |
| `npm-vercel-prior-slim.json` / `npm-vercel-current-slim.json` | `https://registry.npmjs.org/vercel` | Job A |
| `npm-vercel-latest.json` | npm version document `vercel@59.15.1` | Job A second snapshot (no `published_at`) |
| `eol-nodejs-prior-slim.json` / `eol-nodejs-current-slim.json` | `https://endoflife.date/api/nodejs.json` | Job B |
| `eol-nodejs.json` | same API, full cycle list | Job B second snapshot |
| `npm-claude-code-prior-slim.json` / `npm-claude-code-current-slim.json` | `https://registry.npmjs.org/@anthropic-ai/claude-code` | Job C |
| `npm-claude-code-latest.json` | npm version document `2.1.267` | Job C second snapshot |
| `crates-serde.json`, `pypi-httpx.json`, `github-vercel-releases.json`, `github-x402-releases.json` | rejected | `NEGATIVE-EVIDENCE.md` |
