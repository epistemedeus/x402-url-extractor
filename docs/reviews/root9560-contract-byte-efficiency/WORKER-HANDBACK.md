# ROOT9560 source handback

Complete page-change contracts now share repeated schema structure within each
emitted document. Compact serialization was measured first: existing Express
responses already equal compact JSON, so whitespace saves **zero bytes**.
Four OpenAPI component schemas remove repeated artifact/merchant/C1/row structure.
Reused identical Zod nodes let the unchanged pinned SDK emit references rooted in
that tool's own input schema. No new dependency, resolver or discovery endpoint.
Every operation, constraint, annotation and complete example remains equivalent.

| Mounted surface | Baseline UTF-8 bytes | Candidate UTF-8 bytes |
| --- | ---: | ---: |
| Root `/openapi.json` (also Swagger) | 196802 | 177049 |
| Standalone page-change OpenAPI | 41172 | 21419 |
| MPP OpenAPI | 216546 | 196793 |
| Registered `page_change` tool document | 36074 | 11432 |
| Complete `tools/list` SSE wire | 131699 | 107057 |

The standalone document and individual tool meet the provisional 24576-byte
measurement target; full merchant documents/list remain larger. HTTP captures
are ASCII here, so measured characters equal UTF-8 bytes. The original consumer's
11515-character display truncation is a separate presentation observation, not a
vendor limit. Source savings do not prove installed full visibility.

Tested implementation head `9f305dea12884a737b47c24b356c614fe142611f`, tree
`8f980f94fa79211ee3935fd8e45f18a6a80b9079`; the final export adds only these two
safe records. Base/product `d9e5cde379cf7798f473d0cc6bf2139c9ec857d9`, tree
`07c318634e8926a3f12446a2c962b320c74efcc9`. Operating/assignment publication is
separately `b54d36b2c68bb728484a8a26738eac947c719b78`. All sixteen complete product
buffers and four receipt-bound operating buffers pass byte/blob/SHA256 readback;
the frozen receiving record was also read. Exact bindings/diff/hash are in
[EVIDENCE.json](EVIDENCE.json), derived from supplied SPEC/receipt bindings rather
than claiming access to Root's private closure store.

The native session is `01a176f7-a517-71a0-8dd9-ce808e5f6bb2`, admitted
`gpt-6.1-sol/high`, one parent, zero model children, 2097152 KiB total reservation.
Commands use Node 512 MiB, UV1, OMP1 and test concurrency 1; Node v22.23.4/npm10.9.9.
No other job, store, anchor or admission/lifetime guard was changed.

## Receiving and self-review

Disposable exact-product mounts freeze complete baseline documents; candidate
HTTP raw serialization must equal compact serialization. An independent oracle
resolves only local JSON pointers against each actual document/tool schema,
rejects cycles/unresolved/non-object/external targets and conflicting siblings,
and deep-compares all dereferenced content. Only the four new representation
definitions are removed after resolution; no operation, description, example,
array ordering or schema keyword is normalized away. Raw document-aware AJV
compilation also validates OpenAPI references without the oracle. Every registered
MCP input schema independently compiles with no OpenAPI/other-tool dependency.

Actual HTTP and registered MCP tests receive changed/unchanged/incomplete inputs,
merchant/envelope/C1 compatibility and the intentional incomparable diagnostic.
Complete examples validate against their proper branches and produce the expected
one title delta, unchanged description, correct source identity and unknown
freshness. Wrong-target, unresolved, cycle and external-reference counterfactuals
fail. A schema-valid unchanged artifact advertised as title-changed fails both
exact equivalence and actual HTTP/MCP behavior assertions.

Final focused receiving: **95 tests, 93 pass, 0 fail, 2 optional skips** (unsupplied
official XAgent validator). Trial/discovery/replay/paywall preservation:
**198 pass, 0 fail**. Exact baseline receiving preserves paid contracts/challenges,
unrelated tools and raw human/assets, plus trial declaration and paid-effect terms.
Existing tests preserve finite authority/expiry and replay; no live trial is used.
HTTP admission/execution/mount suffix is byte-identical to product base; parser,
engine, paid/financial sources, locks, human assets and production config are untouched.

Developmental observations are retained in evidence: initial full comparisons
failed on producer wall-clock annotations before using one frozen clock; the first
focused run failed because the older baseline lacks the shared module. Its helper
now copies actual Git members and starts listeners afterward. That failed run's
tail briefly overlapped corrected-run startup; final receiving commands were
sequential. No failing comparison was fixed by stripping annotations or semantics.

## Repeatable remote receiving

```sh
NODE_OPTIONS=--max-old-space-size=512 UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 \
  npm ci --ignore-scripts --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=512 UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 \
  node --test --test-concurrency=1 page-change-http.test.mjs \
  page-change-http.mounted.test.mjs extract-batch-page-change.test.mjs \
  page-change-xagent-package.test.mjs mcp-tool-metadata.test.mjs
NODE_OPTIONS=--max-old-space-size=512 UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 \
  node --test --test-concurrency=1 extraction-trial-discovery.test.mjs \
  extraction-trial.http.test.mjs idempotency-replay.test.mjs \
  paywall-applicability.http.test.mjs
```

For just the byte/equivalence/negative qualification, add
`--test-name-pattern=ROOT9560` and run `page-change-http.mounted.test.mjs` alone.
Tests use disposable local mounts/fake facilitator and inert synthetic identities.
Raw captures/logs stay private; optional `ROOT9560_CAPTURE_DIR` selects an existing
private directory for baseline/candidate captures.

The original successful hosted semantic comparison and earlier invalid-input/prompt
confound remain preserved. This is source efficiency qualification, not failed
comparison repair, customer demand, a paid commission or revenue. Root owns later
integration, deployment and actual configured-consumer receiving. No deployment,
live consumer/model/target/account/payment/signing/trial POST occurred here.
