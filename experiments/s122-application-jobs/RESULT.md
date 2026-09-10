# RESULT — S122 application jobs

Three recipes survived qualification and pass offline tests.

| Recipe | Input | Checkable change | Next action on fixtures | Second snapshot |
| --- | --- | --- | --- | --- |
| `npm-cli-release-followup` | vercel pin 59.9.1 + notes + npm slim | 59.9.1 → 59.15.1 (minor) | `review_changelog` | version-doc without `published_at` → partial correction; matching slim → return |
| `runtime-eol-watch` | Node 20/22/24 + clock + horizon 90 | identical API rows; clock crosses Node 20 EOL | `upgrade_now` | full API array returns `upgrade_now` |
| `agent-cli-release-followup` | claude-code pin 2.1.260 + flag-sensitive notes | 2.1.260 → 2.1.267 (patch) | `refresh_agent_tool_notes` | matching slim returns; ignorePatch → `no_action` on same evidence |

Rejected: crates.io serde, PyPI httpx, GitHub vercel monorepo releases, empty
x402 releases, HTML-only page-change, paid extract of free JSON. See
`NEGATIVE-EVIDENCE.md`.

Stop condition met: 3 recipes pass tests with `PRODUCT-EXPERIMENT.md` written.
No default-branch merge. No public posting. Spend $0.
