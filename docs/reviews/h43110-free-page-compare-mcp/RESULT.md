# H43110 RESULT

Free page-comparison MCP on the existing merchant, plus an unpublished plugin draft. Base `9c07ed4c1a170bd80ec8c821a5984b59bb73d9f6`. Branch `codex/h43110-free-page-compare-mcp-20261031`. HEAD is the commit that contains this file (`git rev-parse HEAD` after push). No merge and no production deploy.

## What shipped

`POST /mcp/page-change` is one stateless Streamable HTTP profile. The only tool is `compare_page_observations`. It admits and compares through the existing page-change core. It does not proxy through paid `POST /mcp`. GET and the other methods return 405 so a probe is not a missing listener. The route stays mounted when `PAGE_CHANGE_HTTP_ENABLED` is off and then returns `page_change_http_disabled` as a tool error.

The discovery schema is the existing Zod projection. The handler compares the parsed JSON arguments themselves, with no clone before admission, so the artifact hash keeps the caller's key order. A graph that is inside the byte ceiling but deeper than `maxJsonDepth` is refused as `json_depth_limit` before the SDK sees it. `elapsedMs` stays the only nondeterministic report field. Digests matched the direct `POST /recipes/page-change` route on the cases below.

`POST /mcp/page-change` uses the same request exchange as `POST /recipes/page-change`: configured `maxRequestBytes`, one active-upload slot taken before the body is read, one deadline for the upload and the compare, and abort when the caller disconnects. The compare worker's own concurrency, timeout, and output ceiling stay in force. The HTTP route's 12 requests per IP per minute stays on that route only.

Annotations: `readOnlyHint` true, `destructiveHint` false, `openWorldHint` false, `idempotentHint` true.

## Commands

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 page-change-mcp.http.test.mjs plugins/samedaydesk-page-compare/plugin.test.mjs free-page-change-outcomes.test.mjs page-change-http.test.mjs page-change-http.mounted.test.mjs trial-measurement-continuity.test.mjs commerce-events.test.mjs
```

`npm ci` from the original delivery added 256 packages and exited 0. It was not repeated for this correction. The full `npm test` suite was not run. The command above is the prior profile and draft-package cases plus the free HTTP, admission, worker, telemetry, and paid-boundary files this correction touches.

That command exited 1 after 61999.917076 ms: 198 tests, 196 pass, 2 fail, 0 skipped. The passing set includes the prior profile cases (`ok 158` through `ok 160`), the three new causal cases (`ok 161` deep raw JSON, `ok 162` shared lifecycle, `ok 163` journal), the disabled and catalog cases (`ok 164`, `ok 165`), the draft package (`ok 166` through `ok 168`), commerce events, trial continuity, admission and worker caps, the profile snapshot (`ok 103`), and the shared HTTP slot (`ok 108`).

## Failures and recovery

- A success `tools/call` omits `isError`. The test treats only `isError: true` as a tool failure.
- `GET /extract` of a loopback sink returned 400 before the paywall, because that URL is local. The unpaid catalog check uses `https://example.com/` and got 402. The unpaid paid-catalog `extract` call against the sink returned a payment challenge and the sink received 0 requests.
- The SDK's parsed arguments reordered keys and changed `beforeSha256`, `afterSha256`, and `digestSha256`. The handler admits the parsed `params.arguments` object. Stable output including `digestSha256` matched the direct route. A later correction removed the `structuredClone` of that object. Cloning ran before admission and outside the handler `try`, so a deep object inside the byte ceiling threw `RangeError` and could reject the Express 4 callback.
- An extra top-level `url` is refused by admission with the same `invalid_page_change_input` message as HTTP. `allowFreshClaim: true` is refused by the SDK as an `isError` result whose text contains `-32602` and `allowFreshClaim`.
- A package scan for `sk-` matched the letters inside `samedaydesk-`. The check now requires a token boundary.
- Two mounted tests still fail, and this correction does not change their invariant. `exact source base preserves paid contracts, challenges, unrelated MCP tools and emitted human assets` boots `server.js` from `a6978f989a3bc754421884a3d260be834a84c73a`. `ROOT9560 exact mounted byte qualification, local-ref negatives and example behavior oracle` boots `server.js` from `d9e5cde379cf7798f473d0cc6bf2139c9ec857d9`. Both copies exit in `constructionParityReceipt` with `Machine surface parity invalid: GET /extract must not appear on MPP OpenAPI`. Those commits are from 2026-10-25. `machine-surface-parity.mjs` has required that omission since `ab5bf51` (2026-10-29), and the copies still emit `GET /extract` on the MPP document when `MPP_SECRET_KEY` is empty. Restoring `commerce-events.mjs` to `237990a84cc2feb5f9c826df6111fa0e06dc584a` and rerunning the first test exited 1 with the same message. The amended `server.js`, with `MPP_SECRET_KEY` empty, completed that check (`construction: 23 actions`) and printed the listening line. The MPP rule stays as written.

## Parity and review cases run on this VM

Direct route and MCP, stable deep equal, `charged` false:

- w5 case-0001 changed
- w5 case-0000 unchanged
- w5 case-0002 reordered
- w5 case-0004 incomplete
- `merchant/duplicate-active.json` on both sides, field `title`, ambiguous
- `{before:{}, after:{}, fields:["title"]}`, incomparable
- `pageChangeRequestExample()`, changed

Same error code and message as HTTP: bad clock, filesystem `path`, URL-only artifact, nested `maxBytes`, extra top-level `url`.

Refusals with no compare worker: malformed JSON, a body over the configured page-change byte ceiling (`413 payload_too_large`, not the paid MCP JSON-RPC overlimit response), text body, JSON-RPC batch, and tools `extract`, `read`, `trial_read`, `page_change`, `compare_pages`. A 20KiB body is still under that ceiling, is accepted by this profile's parser, and still returns Unknown tool. The paid catalog test also rejected `extract` and `trial_read` on this profile.

A raw tools/call whose `arguments` are 3000 nested objects was built as text, not by `JSON.stringify` of a live value. `JSON.parse` of that text succeeds and `structuredClone` of the arguments throws `RangeError`. The live route returned `json_depth_limit` with no stack text and no unhandled rejection. The next SDK `tools/call` on that same server returned the public example's `changed` report.

With a smaller configured ceiling, a declared 1024-byte body and a chunked 1024-byte body both returned `413` without waiting out the deadline. With `maxConcurrent` 1, a slow MCP upload made the next call `503 page_change_busy`; disconnecting the upload let a later SDK compare succeed. A slow upload plus a sleep worker returned `compare_timeout` inside the original deadline, and a disconnected compare left no page-change child. Thirteen MCP `initialize` calls were not rate limited. On a full `server.js`, a slow `POST /mcp/page-change` occupied the same slot as `POST /recipes/page-change`.

The five positive and three negative cases in the draft package are those changed, unchanged, reordered, incomplete, and ambiguous inputs, plus the fetch, paid-or-trial, and delete-or-schedule refusals.

## Catalog guarantees

On one local `server.js` with the flag on, paid `POST /mcp` tool names were deep-equal before and after using the free profile. The test does not hardcode a count. `extract` and `page_change` were present. `compare_page_observations` was absent from paid `tools/list` and from the `GET /mcp` descriptor. `GET /mcp/page-change` was 405. Startup still logged `MCP server:  POST /mcp` with its paid-tool count. The child was gone after the test and the port refused connections. No page-change worker remained.

Not changed: paid tool registration, payment gating, the `page_change` tool, CORS, the homepage, and OpenAPI. The HTTP route's 12-per-minute gate is unchanged and is not copied onto this profile. Both paths still share the compare worker and its concurrency, timeout, and output caps.

The profile now calls `freePageChangeObserver("mcp", { route: "/mcp/page-change" })`. That records route `/mcp/page-change` and transport `page-change-mcp`. It does not register or increment the paid catalog's `/mcp` transport (`parsed_page_change_tools_call`). The snapshot keeps schema `samedaydesk.free-page-change-outcomes.v2` and adds `profiles["/mcp/page-change"]`. Rows can show the comparison outcome, a refusal, or an abort. They do not store the posted page, a secret, or a customer or revenue claim. `initialize` and `tools/list` are not comparison outcomes and are omitted. Source and owner checks stay separate from outside use.

## Draft package

ZIP `plugins/samedaydesk-page-compare-0.1.0-draft.zip` members:

- `plugin.json`
- `mcp.json`
- `LICENSE`
- `README.md`
- `skills/compare-held-pages/SKILL.md`
- `examples/public-two-observations.json`

Official schema bytes, retrieved 2026-10-31, are under `plugins/samedaydesk-page-compare/test/official-schemas/` with `PROVENANCE.json`. They match the live responses:

- `plugin.schema.json` sha256 `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883`, last-modified Thu, 29 Oct 2026 21:10:52 GMT, 1805 bytes
- `mcp.schema.json` sha256 `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb`, last-modified Thu, 29 Oct 2026 23:43:38 GMT, 3408 bytes
- `https://agent-plugins.org/schemas/1.1.0/mcp.schema.json` returned 404

`plugin.json` and `mcp.json` validate against those schemas. The ZIP bytes match the package files. Tests, provenance, and this note are not in the ZIP.

## Satisfied and missing

Satisfied: one free tool on the existing merchant, SDK client against the mounted server, direct-route parity, malformed and paid/extract/trial refusals, unchanged paid catalog, schema-valid draft with the MCP connection in the first ZIP, five positive and three negative cases run locally, machine-first usage and one public synthetic example in the package README.

Missing, and not invented: deployed `POST https://agents.samedaydesk.com/mcp/page-change` (live GET was 404 before this branch), domain challenge, verified developer identity, Apps Management Write, `supportURL`, `privacyPolicyURL`, `termsOfServiceURL`, `review.demo_recording_url`, and listing icons. `homepage` does not fill those listing URLs.

Schema gap: the 31 Oct 2026 docs ask for `extensions["com.openai"].auth` on the MCP server. The current `mcp.schema.json` rejects that object (`additionalProperties` false). This package stays schema-valid and omits it. The server has no authentication. Paid x402 routes are not reclassified and are not in this plugin. Machine schema validity, static ZIP validity, and submission readiness stay separate. The package is an explicit draft.

## Inventory for this correction

- `page-change-http.mjs`
- `page-change-mcp.mjs`
- `commerce-events.mjs`
- `server.js`
- `page-change-mcp.http.test.mjs`
- `page-change-http.mounted.test.mjs`
- `free-page-change-outcomes.test.mjs`
- `docs/reviews/h43110-free-page-compare-mcp/RESULT.md`
- `docs/reviews/h43110-free-page-compare-mcp/DRAFT-SUPPORT-PRIVACY.md`

The draft ZIP, plugin manifests, and official schema bytes are unchanged.

## NEXT

Smallest operator acceptance, in order:

1. Deploy this branch to the existing merchant. Do not open a second service.
2. Confirm live `POST /mcp/page-change` initializes and `tools/list` returns only `compare_page_observations` with the annotations above.
3. Complete the domain challenge and verified identity in the portal.
4. Review `DRAFT-SUPPORT-PRIVACY.md` and publish real support, privacy, and terms URLs only after that review. Then add those URLs, a demo recording, and any required icon in a later package.
5. Upload this first ZIP. Connect `https://agents.samedaydesk.com/mcp/page-change` with no authentication. The schema cannot carry the docs' auth object.
6. Scan tools. Do not merge, list, or publish until those steps are done.

The two historical source-base startup failures above are not an acceptance step for this profile. Do not weaken the MPP OpenAPI rule to make those old copies start.

No credentials, signer, payment, or resident job were used.

## Root mounted-alias receiving

Root independently reproduced the original198-case union:196pass/2historical
fixture failures. A real trailing-slash call then reproduced408after the
ordinary parser consumed it. The shared path matcher now follows Express
case/trailing-slash routing before body parsing. Canonical,trailing-slash and
mixed-case calls return useful comparisons;20KiBunknown-tool calls use the
free profile ceiling. The first Root candidate accidentally omitted an import
still used by the observer;that failed isolated startup is preserved,not published.
The corrected full union and42current payment/construction cases are received
separately;the two original historical-source failures remain failures. No
production deployment,paid call or human asset changes occurred.
