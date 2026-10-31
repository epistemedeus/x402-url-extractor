# H84010 RESULT

Usable free-comparison acquisition and bounded refusal evidence on the existing merchant. Base `7138c170c7c5d06dae0568466b7a93b77439bbda`. Branch `codex/h84010-free-comparison-refusal-evidence-20261031`. No merge, deploy, production call, or new account.

## What shipped

`POST /mcp/page-change` was already mounted. Cold `GET /llms.txt`, `GET /.well-known/skills/page-change/SKILL.md`, and `GET /.well-known/agent-card.json` now name that URL, the tool `compare_page_observations`, the shared held-observation example, and the no-fetch / no-payment behavior. The llms block is not a paid markdown link. The agent-card skill id is `compare-held-page-observations` and is omitted when the flag is off. The portable page-change `SKILL.md` is unchanged; the live section is appended only when that skill is served. Paid `/mcp` names, prices, the 23 priced tools, `/skill.md`, `/api/actions`, and the human gateway are unchanged.

Refusal evidence stays on the existing commerce journal. A row may carry optional `pageChangeRefusal: {v:1, stage, reason}` only when the server allowlist accepts the code for the outcome that is actually stored. Aliases, padded strings, objects, and caller or worker messages are dropped. Legacy rows with no label stay unknown. Outcome schema stays `samedaydesk.free-page-change-outcomes.v2`. The readout adds `samedaydesk.free-page-change-refusals.v1` on `freePageChange` without changing outcome counts, populations, window cutoffs, or the split between `http`, paid `/mcp`, and `/mcp/page-change`. Parser and unknown-tool failures stay on the profile that saw them. They are not useful comparisons and are not moved into the paid `/mcp` bucket. Counts are not intent, people, conversion, or revenue.

## Comparison

Against admitted base `7138c170`, with one frozen clock, HTML routes, favicons, `/skill.md`, `/SKILL.md`, JSON `/`, and `/api/actions` were raw-equal. `/llms.txt` and the agent card matched after removing only the new projection. The served page-change skill was the portable file plus the live appendix. `tools/list` on `POST /mcp/page-change` named `compare_page_observations`. `GET /mcp` did not.

Mounted `GET /v0/commerce-demand.json` consumed the refusal aggregate. One parser run recorded external `parser.json_depth` 1, `capacity.busy` 1, `admission.incompatible_input` 9, `capacity.rate_limited` 1, and `transport.aborted` 1, with unknown 0. A malformed paid `/mcp` body did not add a free-comparison refusal. A disabled profile stored `admission.disabled`. A worker code `sleep_elapsed` stayed in the tool result and was absent from the journal. `invalid_worker_path` stored as `core.compare_failed` and did not store the path or the worker message.

## Tests

Serial `node --test --test-concurrency=1` with `NODE_OPTIONS=--max-old-space-size=512`. Full `npm test` was not run.

Pass: `machine-surface-parity.test.mjs` 15, `a2a-storefront.test.mjs` 6, `construction-surface.test.mjs` 5, `free-page-change-outcomes.test.mjs` 9, `trial-measurement-continuity.test.mjs` 9, `well-known-skills.test.mjs` 9, `page-change-http.test.mjs` 27, `hermes-native.test.mjs` 5, `plugins/samedaydesk-x402/plugin.test.mjs` 7 pass and 1 pre-existing skip, `plugins/samedaydesk-page-compare/plugin.test.mjs` 3, `page-change-mcp.http.test.mjs` 10, `well-known-skills.mounted.test.mjs` 3, `machine-surface-parity.http.test.mjs` 1, `careers-board.http.test.mjs` 2, `discovery-method-parity.http.test.mjs` 1, `skill-contract.test.mjs` 3, `gateway-landing.test.mjs` 3, `commerce-events.test.mjs` 97, `startup-smoke.test.mjs` 2.

`page-change-http.mounted.test.mjs`: 48 tests, 46 pass, 2 fail. The new admitted-base byte compare passed. The two failures are `exact source base preserves paid contracts...` (`a6978f98`) and `ROOT9560 exact mounted byte qualification...` (`d9e5cde3`). Both die in the unchanged check `GET /extract must not appear on MPP OpenAPI` while booting an older `server.js` with an empty `MPP_SECRET_KEY`. H43110 already recorded that pair.

`extraction-trial-discovery.test.mjs`: the current-server availability cases passed. `exact admitted base preserves paid documents...` fails the same MPP boot for `c2aeb77a`. That failure reproduced on a clean checkout of `7138c170`. `aiax-discovery/discovery.test.mjs`: 9 tests, 7 pass, 2 fail. The baseline mirror (`e291d41c` `server.js` plus current parity) throws that same check. This diff does not change the MPP rule.

## Files

New: `page-change-refusal.mjs`, `page-change-free-surface.mjs`, this result. The surface helpers are outside `page-change-input-contract.mjs` so a historical copy of that contract can still load the current machine modules. That contract file is unchanged.

Edited: `commerce-events.mjs`, `page-change-http.mjs`, `page-change-mcp.mjs`, `mcp-server.mjs`, `server.js`, `machine-surface-parity.mjs`, `a2a-storefront.mjs`, `well-known-skills.mjs`, and the focused tests named above.

## NEXT

Root owns merge, deploy, and the later one-read live receiving. Zero outside free-MCP observations from before this projection are not a market veto. Refusal counts are not demand. H82010 still owns the historical fixture and release receiver. No paid call, credential, customer body, or resident monitor was used.
