# H43110 RESULT

Free page-comparison MCP on the existing merchant, plus an unpublished plugin draft. Base `9c07ed4c1a170bd80ec8c821a5984b59bb73d9f6`. Branch `codex/h43110-free-page-compare-mcp-20261031`. HEAD is the commit that contains this file (`git rev-parse HEAD` after push). No merge and no production deploy.

## What shipped

`POST /mcp/page-change` is one stateless Streamable HTTP profile. The only tool is `compare_page_observations`. It admits and compares through the existing page-change core. It does not proxy through paid `POST /mcp`. GET and the other methods return 405 so a probe is not a missing listener. The route stays mounted when `PAGE_CHANGE_HTTP_ENABLED` is off and then returns `page_change_http_disabled` as a tool error.

The discovery schema is the existing Zod projection. The handler compares the raw JSON arguments so admission, not the SDK's key order, owns the artifact hash. `elapsedMs` stays the only nondeterministic report field. Digests matched the direct `POST /recipes/page-change` route on the cases below.

Annotations: `readOnlyHint` true, `destructiveHint` false, `openWorldHint` false, `idempotentHint` true.

## Commands

```bash
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-concurrency=1 page-change-mcp.http.test.mjs plugins/samedaydesk-page-compare/plugin.test.mjs
```

`npm ci` added 256 packages and exited 0. The focused test run exited 0: 8 passed, 0 failed, about 2.9s. The full `npm test` suite was not run.

## Failures and recovery

- A success `tools/call` omits `isError`. The test treats only `isError: true` as a tool failure.
- `GET /extract` of a loopback sink returned 400 before the paywall, because that URL is local. The unpaid catalog check uses `https://example.com/` and got 402. The unpaid paid-catalog `extract` call against the sink returned a payment challenge and the sink received 0 requests.
- The SDK's parsed arguments reordered keys and changed `beforeSha256`, `afterSha256`, and `digestSha256`. The handler now admits a clone of the raw `params.arguments`. After that, stable output including `digestSha256` matched the direct route.
- An extra top-level `url` is refused by admission with the same `invalid_page_change_input` message as HTTP. `allowFreshClaim: true` is refused by the SDK as an `isError` result whose text contains `-32602` and `allowFreshClaim`.
- A package scan for `sk-` matched the letters inside `samedaydesk-`. The check now requires a token boundary.

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

Refusals with no compare worker: malformed JSON, oversized body, text body, JSON-RPC batch, and tools `extract`, `read`, `trial_read`, `page_change`, `compare_pages`. A 20KiB body is accepted by this profile's parser and still returns Unknown tool. The paid catalog test also rejected `extract` and `trial_read` on this profile.

The five positive and three negative cases in the draft package are those changed, unchanged, reordered, incomplete, and ambiguous inputs, plus the fetch, paid-or-trial, and delete-or-schedule refusals.

## Catalog guarantees

On one local `server.js` with the flag on, paid `POST /mcp` tool names were deep-equal before and after using the free profile. The test does not hardcode a count. `extract` and `page_change` were present. `compare_page_observations` was absent from paid `tools/list` and from the `GET /mcp` descriptor. `GET /mcp/page-change` was 405. Startup still logged `MCP server:  POST /mcp` with its paid-tool count. The child was gone after the test and the port refused connections. No page-change worker remained.

Not changed: paid tool registration, payment gating, the `page_change` tool, CORS, the homepage, OpenAPI, and `freePageChangeObserver`. This profile does not call that observer. The HTTP route's 12-per-minute gate is unchanged and is not copied onto this profile. Both paths still share the compare worker.

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

## NEXT

Smallest operator acceptance, in order:

1. Deploy this branch to the existing merchant. Do not open a second service.
2. Confirm live `POST /mcp/page-change` initializes and `tools/list` returns only `compare_page_observations` with the annotations above.
3. Complete the domain challenge and verified identity in the portal.
4. Review `DRAFT-SUPPORT-PRIVACY.md` and publish real support, privacy, and terms URLs only after that review. Then add those URLs, a demo recording, and any required icon in a later package.
5. Upload this first ZIP. Connect `https://agents.samedaydesk.com/mcp/page-change` with no authentication. The schema cannot carry the docs' auth object.
6. Scan tools. Do not merge, list, or publish until those steps are done.

No credentials, signer, payment, or resident job were used.
