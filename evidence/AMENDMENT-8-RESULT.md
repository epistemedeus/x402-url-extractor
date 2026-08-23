# OpenAPI request-example parity Amendment 10 candidate result (Amendment 8 result path)

Date: 2026-08-23 UTC
Mutator of record for this rewrite: Hermes Agent (ox-alpha via Nous Portal), remediation pass under the exact-tree BLOCK `worker-output/openapi-amend10-remote-codex-audit/INDEPENDENT-EXACT-TREE-AUDIT.md` SHA-256 `7a46fe27d471337b770430e76e4a0c8126b0c83e94b010f81ec35198054a6a5f`, which is the blocking audit that governs scope. The separate Hermes Amendment 11 assignment at
`/workspace/pilot/receipts/openapi-amend10-hermes-implementation-20260823/authority/OPENAPI-AMENDMENT-10-HERMES-OX-SAME-WORKTREE-IMPLEMENTATION-ASSIGNMENT-2026-08-23.md`
is a distinct artifact with SHA-256
`570d9a12b4fbd898697e1e2382efe27ed5c5deb4374c41dff389e4ac3c69c185`; it is not the blocking audit.
Status: **IMPLEMENTED / REMEDIATED, UNCOMMITTED, QUARANTINED — completion is not acceptance**

This file is the authorized write-last candidate receipt required by Amendment 10
section 10. It was rewritten last, after the other five allowed paths reached
their final bytes; every hash below was recomputed from those final bytes before
this file was written. This is an uncommitted candidate in a quarantined
worktree. It is not integration, release, publication, deployment, demand,
payment, settlement, or revenue evidence. No commit, push, deploy,
authentication, credential, wallet, signer, payment, price, route, network,
asset, recipient, settlement, listener, live-traffic, or B1 action was taken or
authorized.

## 1. Authority chain

| Artifact | SHA-256 |
| --- | --- |
| Amendment 9 frozen contract (`OPENAPI-REQUEST-EXAMPLE-PARITY-E5DEA89-AMENDMENT-9-FROZEN-CONTRACT-2026-08-22.md`) | `1fd6806696edbcf759bff57a784e3bbd16ec0467f891215e80a83f5a020aa47d` |
| Amendment 9 independent AMEND audit | `837d54e9d0b6d4f04fdc86ec4fc3eafac3fc6538914a909ef55da4a388171fb2` |
| Amendment 10 frozen contract | `e9a1ee8f5ab9e9073e4b51e36cac64757714241b15770b58557e5e620c3d07ba` |
| Amendment 10 independent ACCEPT audit | `7141c82a4c41075c63c79c4e29eadae55e88dffbf5287e53b2c97e34a4dd2ab9` |
| Blocking independent exact-tree audit, `worker-output/openapi-amend10-remote-codex-audit/INDEPENDENT-EXACT-TREE-AUDIT.md` (Amendment 11 remediation authority; findings B1 and B2) | `7a46fe27d471337b770430e76e4a0c8126b0c83e94b010f81ec35198054a6a5f` |
| Hermes Amendment 11 assignment, `/workspace/pilot/receipts/openapi-amend10-hermes-implementation-20260823/authority/OPENAPI-AMENDMENT-10-HERMES-OX-SAME-WORKTREE-IMPLEMENTATION-ASSIGNMENT-2026-08-23.md` (distinct from the blocking audit above) | `570d9a12b4fbd898697e1e2382efe27ed5c5deb4374c41dff389e4ac3c69c185` |
| Amendment 12 blocking review, `research/audits/openapi-amend11-remote-codex-r2/INDEPENDENT-EXACT-TREE-AUDIT.md` (receipt-hash correction authority; finding A11-1) | see external Amendment 12 RESULT; not a candidate-tree path |

Worktree identity (unchanged through this pass): HEAD
`e5dea8913ac7264f69b2b2fcbf2ddf2ae52e6ab1`, tree
`3888ace6e4a08a88c02b197b225b8cb5202c05e8`, parent
`d397805fe37cd7c31e02190401750fc328e24907`, detached HEAD, index empty
(`git diff --cached` empty), porcelain exactly the six allowed paths.

## 2. Final SHA-256 of the five other allowed paths (this file excluded)

| Path | Final SHA-256 | Change class |
| --- | --- | --- |
| `openapi-request-example-parity.mjs` | `07c8f4693a67ebc3891d96632d849c34a7fa8a95b38afcfbc5b26c9f013efaf5` | mandatory (B1 remediation) |
| `openapi-request-example-parity.test.mjs` | `edd24995056dd186ab296ca6ad93c3a073bc9d9d9b329f44aab048b6cc4d658f` | mandatory (B1 non-vacuous tests) |
| `package.json` | `18553748d2664fc5c9f4ef16a9cd408ba32317f84d2ec41a9098e63ccd74759e` | byte-identical to continuation |
| `package-lock.json` | `bb6c61d21934068073f6967af4837ca85ffac7dcc8811d8f6faa31ea162501e6` | byte-identical to continuation |
| `server.js` | `1df834515631c4a2ad89f9bc135d8a00ef9b44b9197c71cdb7a2118bfb49f42c` | A9 §12.1 comment/abort-text only |

Changed-path set is exactly the six allowed paths. Nothing is staged.

## 3. P3 third-envelope controlled outcome (A10 §4)

Fixture proven from the fixed public transform before use:
`percentEncode1("%") = "%25"`, `percentEncode1²("%") = "%25%32%35"`,
`percentEncode3("%") = P3 = "%25%32%35%25%33%32%25%33%35"`.

After `resetParityAuthorityForTests()` and successful
`prepareSchemaAuthority({ type: "string" })`, pinned Node v22.23.2:

```text
validateExampleAgainstSchema(P3, { type: "string" }, "$")
  -> exactly one finding:
     [{ code: "PERCENT_DECODE_LIMIT", message: "$: percent decode limit" }]
  no TypeError, RangeError, or URIError; no later stage inspection
"%80", "%C0%AF", "%FF"
  -> exactly one MALFORMED_PERCENT finding each ("$: malformed percent envelope")
```

B1 remediation: the prepared duplicate came from `stringSafety()` re-emitting
the controlled decoder finding already emitted by `unsafeExampleFindings`.
The duplicated push was removed; `stringSafety` now returns immediately on a
controlled percent `ParityError`. The clean negative is preserved:
`decodePlainStages("%252525") -> { stages: ["%252525"], outcome: "clean" }`
and prepared `validateExampleAgainstSchema("%252525", { type: "string" }, "$")`
returns `[]` (first code null), with no special case.

The focused tests are non-vacuous: they assert the complete array by length and
deep equality (`findings.length === 1` plus full-array `assert.deepEqual` for
P3, `%80`, `%C0%AF`, `%FF`), and each value wraps the actual production call
`validateExampleAgainstSchema(...)` in `try/catch` with `assert.fail` so any
escaping native error fails the node — replacing the prior empty `try` block.

Record: `A10.S.prepared-third-envelope -> PERCENT_DECODE_LIMIT` (actual).

## 4. Partial cache-restore fault (live pre/post evidence)

Two fresh post-bind `D_auth` bindings, `injectFailureAt: "after-cache-bind"` +
`injectRollbackFault: "cache-restore"`, pinned Node, reviewer-probe observed
values reproduced identically after the B1 fix:

```text
prior process-cache keys : [ac3604562df050704ba1a641fb11ea5ece63427a4df35010f6dd5a13b3679cf7]
live keys after abort    : [098c2913a6971eb61945877882fa864e79181b5fac505f71c0154ecc9b8472eb,
                            ac3604562df050704ba1a641fb11ea5ece63427a4df35010f6dd5a13b3679cf7]
exactly one of two new keys remained: 098c2913… (one real restore deletion)
every prior binding preserved by === object identity
rollback.processCacheUnchanged   : false (honest)
rollback.stagedDiscarded         : 0
rollback.parityRegistryEmpty     : true
rollback.publishedPointerUnchanged: true
stage CACHE_BIND; primary CACHE_TRANSACTION_ABORTED; returns, never throws
```

No validator function or internal binding object is serialized here.
Records: `A10.R.cache-restore-fault-honest -> CACHE_TRANSACTION_ABORTED`.

## 5. Deterministic overlapping-call barrier

Second call during a held owner returned exactly:

```text
{ ok: false, aborted: true, stage: null, primaryCode: "CACHE_TRANSACTION_ABORTED",
  stages: [], rollback: { stagedDiscarded: 0, processCacheUnchanged: true,
  sourceDigestsReproduced: true, parityRegistryEmpty: true,
  publishedPointerUnchanged: true } }
```

with second builder calls = 0, no live cache/registry/semantic mutation before
release, reset refused while active, and the released first owner completing
all ten ordered stages (`STARTUP_STAGES`) with `ok: true`.
Record: `A10.R.overlapping-transaction -> CACHE_TRANSACTION_ABORTED`.

## 6. Published semantic stability

Prior boot produced non-null `structuredClone(publishedStartupReceipt())`; late
hostile abort after `CACHE_BIND` with normal full rollback; internal pointer
flag `publishedPointerUnchanged === true`; fresh post-call semantic receipt deep
strict-equal to the frozen pre-call snapshot; no listener and no successful
publication from the hostile call.
Record: `A10.R.published-semantic-receipt -> null`.

## 7. Manifest arithmetic (A9 subset + Amendment 10 combined)

```text
combined count: 28 unique IDs (24 A9 + 4 A10); R5 family separate (255 IDs)
A9  manifest cffdd416c580dced86bedf09b2eb467bce8f0ce99791684b9684bcdfd03c93c4  MATCH
A9  primary  89c8afa9b90c66135348d5c609847a3c1929937c15c92bcf1b3105b4623fd9cd  MATCH
A10 manifest 8d7a8205619ac38dd2d4d4b917884c1f32ccceb6bcdd980bc236bbbea727d163  MATCH
A10 primary  a6bf8357051528dc48d61f350ed7473c39b85c1f6a07a05c1322a7a09d066209  MATCH
R5 manifest  a81eea07513c5d7f91a380a7a8576414cd9ccf741f3263658ea2a2a80b106e39  MATCH
R5 primary   23e3eef7b8af70525fa3b670fc87ce4f4161df0a035f7f6069ba29f9a7278df3  MATCH
class counts A..P = 40,24,6,57,32,12,9,8,4,12,2,2,7,14,16,10
```

Equations per A10 §8 (tag + 0x00 + bytewise-sorted IDs joined by LF; primary map
adds `ID + 0x00 + (code or "null")`). Each ID recorded exactly once; A9/A10 IDs
never enter `recordHostileProbe`.

## 8. Commands and results (pinned Node 22.23.2)

Pinned executable `/workspace/pilot/toolchain/node-v22.23.2-linux-x64/bin/node`
(v22.23.2). All run after the B1/B2 remediation edits:

| Command | Exit | Result |
| --- | --- | --- |
| `node --check` parity source, focused test, `server.js` | 0 | clean |
| `node --test openapi-request-example-parity.test.mjs` | 0 | `# tests 19`, `# pass 19`, `# fail 0`, `# skipped 0` |
| `node --test construction-surface.test.mjs machine-surface-parity.test.mjs` | 0 | `# tests 12`, `# pass 12`, `# fail 0` |
| `npm test` | 0 | pretest 12/12; `# tests 398`, `# pass 397`, `# fail 0`, `# skipped 1` (inherited skip) |
| reviewer hostile probe `hostile-probes.mjs` (outside candidate tree) | 0 | total percent failure now PASS (length === 1 per envelope), `%252525` clean, partial restore / overlap / boot registry / `$ref:"#"` / redaction / deep policy scan / manifest arithmetic / package exclusion all PASS |
| additional mutator probes (non-`$` path, boolean-schema branch, unsafeExampleFindings object path) | 0 | single value-free findings everywhere; raw bytes absent from serialization |
| `git diff --check` | 0 | clean |
| `git diff --cached --name-status` | 0 | empty (index empty) |
| package continuation hashes vs continuation values | — | both byte-identical |
| porcelain path set | — | exactly the six allowed paths |
| `npm pack --json --pack-destination <outside tree>` | 0 | 151 members; zero evidence/receipt/assignment/transcript/audit-markdown members; tarball SHA-256 `e4efe827d95713b75f5a1682bb81434637e50ab824ef550e4d0d7a36c7b618b0` |
| `npm audit --omit=dev` | 0 | found 0 vulnerabilities |
| `npm ls @hyperjump/json-schema` | 0 | direct `@hyperjump/json-schema@1.17.8` |

## 9. Residual ceilings and honest limitation

This candidate remains uncommitted and quarantined pending a fresh independent
exact-tree review. No demand, independence, authorization, valid delivery,
repeat, revenue, price, deployment, publication, integration, release, payment,
settlement, listener, live-traffic, credential, wallet, signer, network, asset,
or recipient authority was used or granted. B1 was not invoked. Known residual
limitations carried forward: the internal pointer flag remains self-reported
with semantic deep-equality as the independent observation; the transaction
barrier sits at `META_VALIDATE`, the first await point. The pack tarball named
above is diagnostic material stored outside the candidate tree, not release
evidence.
