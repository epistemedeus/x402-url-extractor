# ROOT9420 source handback

The emitted page-change contract now lets a cold caller construct supplied merchant
artifacts, JSON envelopes and existing legacy C1 results. Root and standalone
OpenAPI share typed structure, supported fields and five complete/diagnostic
examples. Free MCP uses the same authority and publishes its complete synthetic
request through the owning metadata decorator. Comparison validation is unchanged.

Tested source head `835dcbe01828da96dd3400b98434169d540bdd14`; tree `7c4c994902534fdbaf948cc5ae2af62c8f29c61f`.
Base `a6978f989a3bc754421884a3d260be834a84c73a`; tree `f61457edcbe55ac8c4da4a64fcc76839e8dfcf94`.
Canonical origin and admitted branch are preserved. This record is committed
separately on that same branch; the final export adds only these two safe records.
The exact six-file source diff is 40300 bytes, SHA-256
`9e69614e41f3f3e794eb1e9552be24ff07fa4b82ea90a8211922146138c7329f` using the command in [EVIDENCE.json](EVIDENCE.json).

The separate Pilot operating/assignment commit remains
`88693b7a0f58914e3d297048160aa042ee9b53df`. All four staged members, receipt,
17 complete product buffers and both full safe operating blobs pass their exact
hash bindings. No private thread, account, auth profile or real store was read.

The original public empty example and the exact safe consumer request are replayed
separately. Both remain uncharged/incomparable. The latter retains the exact
artifact hashes and all eight schema/key/source-identity warnings. Root's original
no-target-URL prompt could exclude even inert synthetic identity strings; the
invalid artifact is not solely attributable to the contract or model. Independently,
the pinned source published untyped artifacts and an incomplete empty example.

## Verification and self-review

All test commands below used `NODE_OPTIONS=--max-old-space-size=512`,
`UV_THREADPOOL_SIZE=1`, `OMP_NUM_THREADS=1` and `--test-concurrency=1`.
Node v22.23.4; npm 10.9.9. Execution was serial, one admitted native
gpt-6.1-sol/high parent, zero model children, 2097152 KiB total reservation.
Admission, provider lifetime, source, capacity, floor and all other guards stayed
unchanged. No other job or anchor was signalled.

| Command / result | Counts / exit |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 244 packages, exit 0; unchanged manifest/lock |
| Baseline: `node --test --test-concurrency=1 --test-name-pattern='cold consumer gets' page-change-http.mounted.test.mjs` | 1 expected failure, exit 1: incomparable instead of changed |
| `node --test --test-concurrency=1 page-change-http.test.mjs page-change-http.mounted.test.mjs extract-batch-page-change.test.mjs page-change-xagent-package.test.mjs mcp-tool-metadata.test.mjs` | 88 tests: 86 pass, 2 optional skips, exit 0 |
| `node --test --test-concurrency=1 extraction-trial-discovery.test.mjs extraction-trial.http.test.mjs idempotency-replay.test.mjs paywall-applicability.http.test.mjs` | 198 tests pass, exit 0 |
| `git diff --check` and exact scope/suffix checks | exit 0 |

The two skips require an unsupplied official XAgent validator checkout. Exploratory
failures from MCP metadata overwrite, a test JSON-schema draft mismatch and test
clock/port variance were corrected; final runs above supersede them. Raw captures
and logs stay private. No new installation dependency was added.

Cold calls consume only emitted examples/description, with no fixture builder or
comparator import. Independent assertions cover source identity, exact before/after
title values, one title delta, unchanged description/control and unknown freshness.
Additional HTTP and registered free-MCP tests cover envelopes/C1, missing/wrong
schema, top/row keys, absent/different identity, selected fields, duplicate sources,
partial/failed rows, malformed JSON, depth/bytes and false freshness authority.
Partial rows retain the engine's existing ability to compare present selected fields.

Self-review confirms that the HTTP admission/execution/mount suffix is byte-identical
to baseline. Parser/engine, paid/financial/authority assets, dependencies/locks,
production configuration and human copy/layout are unchanged. Actual disposable
baseline/current mounts preserve paid OpenAPI documents, exact unsigned challenge,
unrelated MCP definitions, and all 12 emitted human/asset responses after excluding
only the intended page-change request contract. Existing tests preserve replay and
finite trial authority/expiry, including restart/no-replenishment behavior.

## Repeatable cold-consumer receiving

From this source checkout, install the unchanged lock as above, then run:

```sh
NODE_OPTIONS=--max-old-space-size=512 UV_THREADPOOL_SIZE=1 OMP_NUM_THREADS=1 \
  node --test --test-concurrency=1 \
  --test-name-pattern='cold consumer gets|cold free MCP' page-change-http.mounted.test.mjs
```

This launches and closes disposable local `server.js` mounts and a fake facilitator.
The HTTP caller reads either OpenAPI endpoint and copies
`paths["/recipes/page-change"].post.requestBody.content["application/json"].examples.titleChanged.value`.
The MCP caller reads the complete JSON request following the explicit example marker
in `tools/list`'s `page_change.description`, then calls the existing free tool.
Neither path fetches the synthetic `https://synthetic.example.invalid/page` identity.
The unchanged control copies before to after; emitted unchanged/envelope/C1 and
intentional diagnostic examples are also exercised separately.

Root next integrates, independently deploys, verifies installed source identity and
receives the configured RenX consumer with synthetic identity strings explicitly
permitted. No target-service request, live extraction, sign-in, hosted model turn,
payment/signing, trial renewal, deployment or target publication was performed.
Source/test success is not installed repair, consumer adoption, revenue or durable
account retention. Git branch export is the only publication in this package.
