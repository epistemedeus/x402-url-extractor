# Root delivery packet

Base: `32f07a836fb28e400d56b0e2e876043644bde31a`. Source branch: `codex/sol-live-attempt-delivery-261003`. The exact delivered commit is recorded in the draft PR and `/home/ubuntu/root-sol-live-attempt-delivery-261003-result.json`; use that SHA for release. This packet accompanies one native build on the existing Cursor VM. Nothing was deployed or merged. Existing source changes were preserved throughout the provider-capacity interruption.

The received inputs were fetched by exact commit: prior view `4e49c4db58ea0f5897240781fd14d80566bbabd0`, adaptation `e687ca11c2e05e8ac41ede83dc1b98cfe46c3a7c`, completion `0c29e9fb3a9d31269f666a51957067e1ee98a90e`. Only the needed attempt package and canonical integration were received; obsolete ancestry was not merged or cherry-picked. No applicable AGENTS file existed in this repository or its ancestors. Current master supplied the commerce, grant, settlement, observer and server contracts. The frozen 421 projector and original retained journals were preserved.

## Producer and receiver contract

`commerce-journal-admission.mjs` gives the existing canonical writers one reentrant process-local admission gate per resolved directory. Actual constructors register their owned planes; server bootstrap registers runtime identity. HTTP callers cannot register a producer, choose a capture window, assert file bounds or label coverage. The existing enrolled token authenticates a bounded cut marker in `commerce-events.ndjson`; there is no new key, database, result store or revenue classifier.

The capture records an actual start/as-of, process/session, namespace, code fingerprint, each plane's presence, owned writes, rotations, byte ranges and prefix hashes. Publication verifies its physical marker and post-publication prefixes. Reads pin owned regular files without following symlinks. Unregistered writes, malformed/torn records, unreadable or oversized files, unknown owners and lost generations withhold completeness. An absent file can represent a covered empty interval only when its registered canonical owner actually observed that interval and zero writes. A disabled settlement producer remains unknown. Settlement journal coverage and the canonical reconciler's generation/run evidence are separate fields.

The native projection preserves seven separate stages. A fixed-predicate receipt absence can be a useful negative. A server finish and bound transport are delivery observations. The paid consumer now retains the original server-sealed commerce event identity in its canonical artifact row and receives the actual telemetry writer’s branded accepted task binding, preserving an owner-QA cohort rather than replacing it with external_unknown; existing operation-contract delivery and authorized later reads can be established without claiming independent replay. Older paid rows without that identity remain unbound. Settlement requires the canonical reconciler's original event and finish timestamp and remains independently visible when transport observation is missing. A paid public request without internal observation headers is exercised: delivery is unknown, while canonical settlement, retained operation criterion and grant-only later read are separately established. Task execution and payment transaction references are distinct in this fixture. Source/distribution attribution is the existing canonical sanitizer's output; declared sources and `external_unknown` never become independent customers. Recognized revenue in this reader is unknown. The canonical money contracts remain unchanged.

Multiple attempts for one task return separate `attempts[]` (maximum 20), never a combined rate or stage numerator. `journalCutCoverage`, production capture coverage, observation classification, and outside usefulness remain separate. The positive production-context contract test is explicitly an isolated bootstrap fixture; it proves the data-driven branch, not a hosted release or outside use.

Bounds: source files 5 MiB + 8 KiB, total sources 40 MiB; interval ranges 1 MiB each, total interval 2 MiB; 4,000 admitted digests per plane; cut marker 8 KiB. More than one rotation within an interval can lose its start and becomes partial. Captures are operator/observer driven; no retention patrol was added. Restart can replay an existing physical cut at its recorded as-of. A new process begins a new interval. This is single-process coordination, with the existing writer declaration, and uses existing flush/close durability rather than adding an fsync guarantee. Reconciliation shares the gate; an authenticated read can wait for the existing reconciliation/flush work and time out without proving a completed response. Lost acknowledgements do not authorize reminting, provider retries, grant retries or payment replay; later server reads leave caller receipt and applied use unknown.

## Executed validation

Commands ran from `/home/ubuntu/root-sol-live-attempt-261003` on Node `v22.22.2`. `npm ci --ignore-scripts` installed the repository's declared dependencies without changing its lockfile. The Python consumer needed its actual `httpx` prerequisite; `python3 -m pip install --target /tmp/sol-delivery-python 'httpx==0.28.1'` repaired that VM prerequisite. No fake successful Python consumer was substituted.

```sh
node --test --test-concurrency=1 task-linked-delivery/experiments/attempt-useful-view-1005/test/*.test.mjs
# 43 passed, 0 failed: evidence/completion.tap

node --test --test-concurrency=1 commerce-events.test.mjs commerce-outcome-binding.test.mjs commerce-outcome-binding.concurrency.test.mjs commerce-outcome-binding.root.test.mjs commerce-settlement-reconciler.test.mjs commerce-settlement-source-delivery.test.mjs useful-result-reuse.test.mjs useful-result-reuse.http.test.mjs useful-result-reuse.customer-grant.test.mjs useful-result-reuse.customer-http.test.mjs startup-smoke.test.mjs service-version.test.mjs test/merchant-verify.test.mjs
# 225 passed, 0 failed: evidence/canonical.tap

PYTHONPATH=/tmp/sol-delivery-python node --test --test-concurrency=1 commerce-nonlive-suite.test.mjs commerce-privacy-coverage.test.mjs commerce-trust.test.mjs commerce-payment-evidence.test.mjs commerce-settlement-source-delivery.test.mjs settlement-proof.test.mjs purchase-evidence-manifest.test.mjs payment-offer-preflight.test.mjs commerce-rare-funnel.mounted.test.mjs public-acquisition/engine.test.mjs public-acquisition/receiving-lifecycle.test.mjs public-acquisition/receiving-file-bounds.test.mjs docs/reviews/sol398-scoped-repair/mounted-receiving.test.mjs
# 79 passed, 0 failed: evidence/merchant-boundaries.tap

node --test --test-concurrency=1 task-linked-delivery/experiments/free-task-observation-100421/test/*.test.mjs task-linked-delivery/experiments/task-demand-100339/test/observer.test.mjs task-linked-delivery/experiments/production-funnel-100423/test/*.test.mjs task-linked-delivery/receiving.test.mjs
# 28 passed, 0 failed: evidence/dependencies.tap

node task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs check
# applied, export matches: evidence/delta-check.json
```

The focused suite includes real Express middleware, canonical physical files/flush, supplied positive and useful-negative receipt executions, caller true/false assertions, grant reads, current-sidecar authentication, missing-all/missing-plane, registered covered empty, partial/torn/row and file limits, unsafe paths/owners, forged/stale provenance, one rotation/dedup and lost prefixes, concurrent writer/read, process restart, lost retention/read/cut acknowledgements, public count preservation, new capture epochs and repeated task attempts. Payment, source, grants, settlement, signed publication and authority boundaries remain covered by the canonical suites. Counts above are per command, with some shared tests; they are not a count of distinct customer observations.

`evidence/before.tap` runs the same three regression assertions against the exact received `0c29e9f` cut in `/tmp/sol-cut-before`: missing all planes, invented window, and cohort-based provenance promotion all fail. `evidence/after.tap` passes all three against this implementation. `evidence/live-coverage-regression.json` also applies the exact received view to an actual registered mounted cut: its expected complete-coverage assertion fails with hardcoded unresolved, and the native view passes while customer/outside use remain unobserved. This is an explicitly isolated bootstrap contract, not a production receipt. The original received source is reproducible with `git show 0c29e9fb3a9d31269f666a51957067e1ee98a90e:task-linked-delivery/experiments/attempt-useful-view-1005/src/cut.mjs`.

An additional archived `sol398` release-prep assertion was inspected and reproduced on untouched base: 4/5 pass and its historical `master_moved` check still expects seller041 `015f07d`. It is not a current functional release gate; `evidence/historical-release-base.tap` preserves that baseline failure. The historical packet was not rewritten to claim current release. The actual mounted `sol398` consumer passes above. A separate receiving failure was the old control scripts treating the hex substring bc1 inside a random UUID as a stored customer identity. `dependencies-before-guard-fix.tap` preserves that failure; both control receivers now validate the existing closed task-ref record schema, retain label/token checks, and the complete dependency suite passes.

`evidence/preservation.json` compares 328 current/frozen files byte-for-byte with the authoritative base, including public acquisition packets/current readback, public assets, scoped release artifacts, seller sources and version files. The public engine test's generated loopback profile was restored to its original bytes. LICENSE and the received historical `evidence/one-useful-task.json` are retained. Native supplied-export output is separately saved as `evidence/supplied-export-readback.json`. No human page, copy, design or frozen archive was changed. `SOURCE-MANIFEST.json` and the package PIN record the delivered source file hashes.

## Actual isolated mount and physical receiving

```sh
SOL_ATTEMPT_PRESERVE_CAPTURE=1 node --test task-linked-delivery/experiments/attempt-useful-view-1005/test/server-mounted.test.mjs
# 1 passed: evidence/persisted-server-mount.tap
```

`evidence/server-entry-readback.json` records the actual loopback `server.js` mount, version `1.23.49`, anonymous frozen archive SHA-256 `64dbe1ee7f69dd40ebf71741eed92f1f3f893c44af8eadf18b71c0fac82227b8`, retained original journal directory, task, event and cut. The genuine canonical receipt route returns its existing 402 challenge; no free bypass was added. The server is stopped. The original physical directory is preserved on this VM, rather than reminting its inode/namespace proof into a copied fixture. `evidence/physical-cold-readback.json` proves an identical stage projection from a separate Node process after server exit. Settlement was deliberately disabled in this isolated entry, so its plane is unknown and total journal coverage is partial.

Root can repeat that preserved physical read without a model or network request. This uses the pre-existing test authority, never a production credential:

```sh
node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
import { readPersistedAttempt } from './task-linked-delivery/experiments/attempt-useful-view-1005/src/read.mjs';
import { TOKEN } from './task-linked-delivery/experiments/free-task-observation-100421/test/native-ports.mjs';
const r = JSON.parse(readFileSync('docs/reviews/sol-live-attempt-delivery-261003/evidence/server-entry-readback.json', 'utf8'));
console.log(JSON.stringify(await readPersistedAttempt({dataDir:r.persistedDataDir,taskRef:r.taskRef,cutId:r.report.cutId,internalToken:TOKEN}),null,2));
JS
```

`mounted-positive.json`, `mounted-negative.json` and `mounted-paid-consumer.json` are isolated mounted executions. The first two use a real separate receipt replay process. The paid consumer uses an explicit in-memory chain/rail port, actual retention middleware, canonical settlement journal admission and grant-only reads; it invokes no real payment, facilitator or provider. `isolated-journals/` is an audit copy of the free fixture journals; its old namespace is not valid native authority at the copied path. All receipts remain isolated evidence, not production customers, releases, revenue or hosted adoption.

## Root release, readback and rollback

The source preparation commands are model-free, using the existing enrolled GitHub helper and the delivered SHA in `SOURCE_HEAD`:

```sh
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch origin "$SOURCE_HEAD"
git merge-base --is-ancestor 32f07a836fb28e400d56b0e2e876043644bde31a "$SOURCE_HEAD"
git diff --check 32f07a836fb28e400d56b0e2e876043644bde31a "$SOURCE_HEAD"
npm ci --ignore-scripts
```

The existing deployed entry is `node server.js`; `.railwayignore` includes all new native runtime files. As documented by the current [Root receiving pipeline](../sol398-scoped-repair/ROOT-RECEIVING.md), project/service selection and the existing Railway deployment mechanism belong to Root; no new project, credential or invented deployment command is supplied.

1. Receive the exact delivered commit from the result receipt/draft PR. Verify its base ancestry and source hashes. Resolve any future integration conflicts against current main while preserving its current metadata and frozen bytes. Release that pinned source with Root's existing deployment mechanism. No release was invoked here.
2. Keep the existing persistent `COMMERCE_DATA_DIR`, enrolled `COMMERCE_INTERNAL_TOKEN` and `COMMERCE_TELEMETRY_WRITER_PROCESSES=1` declaration. The canonical producers and existing settlement configuration remain authorities. Use the real deployment's `RAILWAY_DEPLOYMENT_ID` and `RAILWAY_GIT_COMMIT_SHA`; a renamed fixture or caller label is not enrollment. No new credential or private prerequisite is added to public execution or archives.
3. Check `/version`, ordinary `/.well-known/useful-result-reuse/current.json`, and an anonymous frozen archive against the same current contracts. Begin an actual new interval with the existing authority before an authorized task/distribution experiment. This performs no task execution or payment:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs --start
```

4. Read a bounded genuine task cut using its existing server-minted task reference, after an authorized observation. `COMMERCE_INTERNAL_TOKEN` must already be in the operator environment. The default origin is `https://agents.samedaydesk.com`; set `COMMERCE_BASE_URL` only for the known deployed service:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs "$TASK_REF" --event "$COMMERCE_EVENT_ID"
# Save the returned cutId; this exact historical read never extends its as-of:
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs "$TASK_REF" --cut-id "$CUT_ID" --event "$COMMERCE_EVENT_ID"
```

The remote command is bounded to 1 MiB/10 seconds, refuses redirects, sends authority only in headers, does not retry, and checks the native response schema rather than treating HTTP 200 as evidence. Local journal replay uses the same authority:

```sh
node task-linked-delivery/experiments/attempt-useful-view-1005/bin/merchant161-delta.mjs read --data-dir "$COMMERCE_DATA_DIR" --task "$TASK_REF" --cut-id "$CUT_ID" --event "$COMMERCE_EVENT_ID"
```

5. Accept coverage only from the returned authenticated producer, recorded interval, file bounds and runtime identity. Genuine production journal coverage can be complete while independent customer usefulness, caller receipt, later applied use and attributable settlement remain unknown. Do not turn those unknowns into zeros, revenue, customers or rates. Actual hosted enrollment and outside usefulness are the remaining production work.
6. Roll back by redeploying Root's previously approved source SHA (this job's starting source is `32f07a836fb28e400d56b0e2e876043644bde31a`). Keep existing journals and grants; do not delete or rewrite capture markers, seller archives or current artifacts. No data migration needs reversal. Old source will no longer serve the native sidecar; the operator reader must reject an ordinary current.json response. Pre-feature commerce integrity may report unfamiliar cut markers as unusable lines after rollback; it cannot count them as commerce events or settlements. Restore the native reader only with a compatible source and its original persisted namespace. Root owns the deployment/readback/rollback decision.
