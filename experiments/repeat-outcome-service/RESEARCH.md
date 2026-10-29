# H64003 research: one maintained advisory decision

Date of the captures: 2026-10-29. Base: `a1dc09bb076b823fb3492ea79fa10f8602ed01a5`. Branch scope: `experiments/repeat-outcome-service/` only.

## Repeatable unit

One check of a named npm pin against one supplied OSV document and one advisory page. The check says whether the document affects the pin, whether that record changed since the last accepted check, whether the page text the existing reader actually returned contradicts the document, and whether a failed page was refused.

## Next consumer

The merchant owner who already pins `axios` at `1.19.0` in `package.json` `overrides`. A later agent operator with the same shape of pin is a hypothesis, not an observed customer. No buyer, no signup, and no outreach was contacted.

## Acquisition

None. This package does not publish, list, or ask anyone to discover it. Acquisition remains Root's later decision.

## Useful-output test

`node --test experiments/repeat-outcome-service/test/outcome.test.mjs` and `node experiments/repeat-outcome-service/bin/run-outcome.mjs`.

The runnable cycles are:

| Cycle | What is supplied | Required result |
| --- | --- | --- |
| initial | Captured OSV query for axios 1.19.0 and the captured GitHub advisory HTML | Decision `affected`, 12 ids, page agrees on the one stated range, product win false |
| no_change | The same bytes again | Monitor verdict `unchanged` and `noChangeProven` |
| change | Laboratory edit of the fixed version to 1.21.0 in the OSV events and in the HTML | Decision stays `affected`, monitor verdict `changed` |
| record-only change | The same OSV edit, original HTML | Page monitor proves no change and still does not decide the pin |
| semantic_failure | Real OSV document, authored page saying the pin is not affected and the range ends at 1.19.0 | Decision stays `affected` from the OSV document |
| recovery | Real OSV document, HTTP 503 page that says the pin is not affected, previous accepted check | Decision stays `affected`, monitor `incomplete`, last good page batch kept |
| direct_only | The same 503 page and OSV document, no previous check | Decision `affected` from the document, page clearance refused |

## Sufficiency baseline

The strongest direct structured feed for this question is `POST https://api.osv.dev/v1/query` with `{"package":{"name":"axios","ecosystem":"npm"},"version":"1.19.0"}`. The evaluation rule is the OSV Schema `IsVulnerable` pseudocode (`https://raw.githubusercontent.com/ossf/osv-schema/main/docs/schema.md`, section Evaluation). `fixed` is exclusive. `last_affected` is inclusive. The string `0` sorts before every parsed version.

That feed wins the factual pin decision. One GitHub advisory page does not carry the other eleven affecting records. The default extract excerpt of 1,200 characters drops the version range. The existing extract call with the markdown budget, and `readMarkdown`, both still show `>= 1.13.0, < 1.20.0` and `Patched versions 1.20.0` for GHSA-3pq3-5fj3-cg6v. The page also says `Not affected: Browser adapters.` The claim parser does not treat that scope line as a clearance of axios 1.19.0. A patched-version label alone is not a clearance, because it names the fix version.

A sufficient direct win is the result. It is not permission to describe the reader as the product.

## Observable next decision

Do not ship a paid advisory-reading offer from this package. Root can separately decide whether the axios override should move. That edit is outside this branch. The 1.20.0 query below is one retrieval, not a standing claim that 1.20.0 stays clear.

## Primary sources, tested

Tested means this package replays the stored bytes or the tests assert the behavior. Inferred means a judgment about a customer or a future pin.

- Tested. `package.json` override `axios` is `1.19.0` at the admitted base.
- Tested. 2026-10-29T14:24:45 GMT, `POST https://api.osv.dev/v1/query` for npm axios 1.19.0 returned HTTP 200 and 12 vulnerabilities. Stored as `fixtures/osv-query-axios-1.19.0.json`. Each npm range is SEMVER and includes 1.19.0 while fixing at 1.20.0. The ids are GHSA-3pq3-5fj3-cg6v, GHSA-44g4-m2mj-wpvx, GHSA-4hqw-qxg8-jxx2, GHSA-542g-h47m-68v8, GHSA-9fr6-4gfg-395g, GHSA-c29m-xwm3-cm6r, GHSA-j8rh-479h-cp32, GHSA-m8m8-qj5v-23w3, GHSA-mghh-pgcx-3jjj, GHSA-r4gj-5m52-g5wh, GHSA-vh66-26gq-q6x8, and GHSA-x97p-jq2g-jp4f.
- Tested. The same route for version 1.20.0 returned a body of `{}` in the same session. Stored as `fixtures/osv-query-axios-1.20.0.json`. The HTTP date for that second call was not saved. Evaluating the 1.19.0 document at version 1.20.0 is also `not_affected`, because `fixed` is exclusive. Version `1.20.0-rc.1` is still affected. Version `0.0.1` is not affected by these twelve ranges.
- Tested. 2026-10-29T14:25:01 GMT, `GET https://github.com/advisories/GHSA-3pq3-5fj3-cg6v` with the merchant extract user agent returned HTTP 200 HTML. ETag `W/"a755e473db5c7c47ef489be88bd1b938"`. The body is stored. The `Set-Cookie` header is not stored. The HTML contains one GHSA id.
- Tested. On that body, default `extract` text does not contain `1.20.0` or `Affected versions`. Extract at the 40,000 character markdown budget does. `readMarkdown` does. Headings include the words Affected versions and Patched versions and not the version numbers, because those numbers sit in sibling elements.
- Tested. The existing monitor `comparePageBatches` reports `unchanged` for a repeated page and `changed` when the raised extract text changes. Its freshness claim stays false. `paymentImpliesUsefulOutput` stays false.
- Tested. An authored page that says `axios 1.19.0 is not affected` and gives an affected range ending at 1.19.0 contradicts the OSV document. The cycle is `semantic_failure`. The decision stays `affected`.
- Tested. An authored HTTP 503 page with the same clearance sentence is refused. With a previous accepted check and an unchanged document, the cycle is `recovery` and the last good page batch is kept. Without a previous check, the cycle is `direct_only` and the document still decides.
- Inferred. Someone other than the owner would repeatedly pay for this check. Not observed.
- Not done. ECB foreign-exchange tables and the PHP calendar comparison. Those direct wins stay as they were recorded. This task is a different pin.

Laboratory HTML under `fixtures/laboratory/` is authored for the contradiction and the failed page. It is not a second capture.

## What was reused

- `extract` and `readMarkdown` from `extract.mjs`, including `buildCapture` (`http-get-no-javascript`, `javascriptExecuted: false`) and the in-process fetch hook `__SAMEDAYDESK_EXTRACT_FETCH__`.
- `comparePageBatches` from `examples/customer-x402/src/page-change/compare.mjs`, the monitor behind the page-change HTTP route. The batch envelope uses the existing product and schema names. `charged` is false. The quote amount is `0` and the quote text says this prototype does not price or charge. No settlement, wallet, or ledger module is called.
- OSV's published evaluation rules. The parser is specific to a supplied document. It is not a new scanner product and it does not fetch OSV at runtime.

## Effort

Each cycle records reader attempts, reader failures, direct parses, monitor compares, recoveries, body bytes, and elapsed milliseconds. `pricing` is null. `charged` is false. `ledgerWrite` is false. Elapsed time is process time for the cycle, not a quote.

## Host limit

Six independent native source streams are not reserved on this host. Source reading ran serially in this parent. No additional native children were spawned.

## Model

Requested model: grok-4.7. Requested effort: xhigh. Observed model: grok-4.7, the model this session identifies. Observed effort: xhigh, the effort named at admission. Requested and observed are recorded separately; both values come from the admission record for session `39d35140-e9b4-49a0-866a-e83d07812133`. This parent did not receive a provider usage meter, so usage is not invented here.

## Integration recommendation

Do not productize an advisory reader from this prototype. For the pinned axios 1.19.0 decision, the OSV query document is a sufficient direct feed: it marks the pin inside 12 npm ranges fixed at 1.20.0, and the same API's axios 1.20.0 query on 2026-10-29 returned no vulnerabilities. The existing reader is useful as a contradiction and continuity check on one human page, not as the release decision. Root should keep this package as laboratory evidence and make any dependency-pin change outside this branch.
