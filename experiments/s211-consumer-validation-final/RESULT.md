# Consumer validation final result

Input: `d9553e2fd81ff62e7a30d23a3c5166ca2d923ed9`.
Tested implementation commit: `d998f11c173ac719043d6351f46e56f48d0f1bb6`.
Final branch: `codex/s211-consumer-validation-final-20260910`.
The final child commit adds archive bytes, provenance pins and this receipt; its hash is returned after export.

Reproduced the supplied invalid plane and numeric ID cases as ok:true/pass before repair. Validation now classifies documented omissions separately from errors. Every validation error blocks normalization, with original code and instancePath retained. Explicit null/scalar containers, IDs, planes, kinds, roles, identity field types, hashes, locator types, clocks and conflicting declarations cannot be repaired into success. Nullable provenance unknowns remain nullable. Missing kind/role/ID/inferable plane/implicit locator and raw lane convenience remain usable.

The normalizer, builder, output validation, S137 packet/family aggregate and S178 import/CLI now agree on malformed refusal. Wrappers preserve supplied clocks and evidence classes. Release-brief input is analyzed directly instead of substituting a fixture by case ID. The item-level identity graph is unchanged: disjoint and false bridges remain unknown; a genuine bridge passes. No merchant handler, payment authority or price changed.

## Actual native execution

Linux 6.18.35, Node **22.23.2**. No model CLI, marketplace request or payment operation.

- Source/schema: **204 passed, 0 failed, 0 skipped**.
- S178 owning acceptance script: **167 checks passed, 0 failures**.
- New portable boundary suite: **148 tests**. Its 146 table cases compare validation, normalization, build, output schema, S137 CLI, S178 literal CLI and S178 import; two additional tests cover wrapper defaults and family aggregate refusal.
- Fresh six-job archive: **148/148** portable tests passed, from its own directory.
- Fresh repeat archive: all **148 portable boundary tests passed**. Broader inherited suite: **203/204**, no skips. The one failure is `source pins still appear in cited repo paths` in `release-brief.test.mjs`: it expects the merchant repository package/version at `../../package.json`, which is the consumer package in an installed kit. This repository-only provenance assertion passes in the source checkout. It was not suppressed or counted as an archive pass; runtime and portable regressions require no parent checkout.
- Literal FIRST-USE commands: source list/example/conflict run and fresh-kit list/07 run/03 import all exited 0; outcomes were conflict/pass/pass as documented. Corrected the source example's relative input path.

Replay from repository root (Node 22):

```sh
node --test experiments/s137-consumer-evidence-jobs/test/*.test.mjs experiments/s137-consumer-evidence-jobs/src/release-brief/schema.mjs
node experiments/s178-consumer-repeat-package/test/acceptance.test.mjs
node experiments/s153-consumer-distribution-gates/kit/scripts/build-archive.mjs
node experiments/s178-consumer-repeat-package/scripts/build-kit.mjs
```

After extracting each archive into a fresh directory:

```sh
# In s137-consumer-evidence-kit
node --test test/release-brief-input-boundary.test.mjs
# In s178-consumer-repeat-kit
node --test vendor/s137-consumer-evidence-jobs/test/release-brief-input-boundary.test.mjs
node bin/s178-cli.mjs run 07 --clock 2026-09-10T18:00:00.000Z
node bin/s178-cli.mjs run 03 --clock 2026-09-10T18:00:00.000Z --mode import
```

## Archive bytes

Both original binaries were retrievable from Git. The committed final archives are **rebuilt bytes**, not an assertion that the original archives passed. Two builds produced identical bytes using sorted tar entries, fixed time/owner and normalized modes. Archive listings contain only relative regular files/directories. All 16 canonical S137 source files match both repeat-kit mirrors and the six-job kit (48 byte comparisons). Archive hashes are external, not embedded self-hashes.

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| S153 `kit/dist/s137-consumer-evidence-kit.tgz` | 211865 | `fa21d718864556a48fb79b4989eb1d72124c3248d2c7fa04b9a23671c8797241` |
| S178 `dist/s178-consumer-repeat-kit.tgz` | 714218 | `a93a7fd3d066acc86d3533ab0ba2b5eb46e4c27102f7795239e4425dcd31438a` |

Runtime edits: S137 `src/release-brief/{schema,transform}.mjs`, `scripts/cli.mjs`; S178 `src/adapters/s137-release-brief.mjs`. Regressions: S137 `test/release-brief-{input-boundary,identity-gate,cli-regression}.test.mjs`. Remaining delta: two builders, first-use documentation, kit source pins, archive/checksum pairs and this receipt. Exact path manifest: `git diff --name-only d9553e2fd81ff62e7a30d23a3c5166ca2d923ed9 HEAD`.

Limits: local declarative evidence and shape/linkage checks, not independent source truth, identity attestation or release acceptance. Archive reproducibility was tested on this native Linux/GNU tar environment. No deployment, hosted readback or publication performed; root owns release.
