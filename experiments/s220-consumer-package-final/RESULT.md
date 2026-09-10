# Consumer package final result

- Frozen input: `778d8ef5c6694b21e71a52b78e9181adeb88cfa4` (S211 branch unchanged).
- Tested source: `361460288e96d43da2f215e158fad96745507fde`.
- Committed archive bytes tested: `d608a2ec81978b096d6b0c3f3c792c51b7c55ee5`.
- Export: `codex/s220-consumer-package-final-20260910`. Final receipt-only child ID is returned separately.

Reproduced the old committed S178 archive's `pin-package-version` failure in a fresh directory. Its fixture explicitly identifies those merchant excerpts as inspiration for synthetic data, not installed consumer metadata. The unchanged assertion now lives in `release-brief-repository.test.mjs` and remains mandatory in the source suite. Only that repository-only file is excluded from consumer archives. Installed tests verify the actual package manifest, source revision and runtime digests, including rejection of changed version, pin and missing/changed digests. These are local integrity checks, not server-version claims or attestations.

Literal first-use replay also found an invalid Express example and truncated family output. The example now uses the existing split function to declare announcement only, without shipped/tested evidence; original captured bytes/hash remain unchanged. The CLI lets stdout drain before exit. Added regressions cover the example, large piped output and complete family JSON. Normalization/schema/identity graph and all 148 boundary tests are byte-identical to S211. Merchant routes, prices and payments are untouched. Prior source pins remain recorded in PINS.json and the frozen branch.

## Actual native gates

Linux 6.18.35, Node **22.23.2**:

| Gate | Result |
| --- | --- |
| Source/schema plus provenance builder regression | 206 passed, 0 failed/skipped |
| S178 owning acceptance | 167 checks passed, 0 failures |
| Fresh S153 `npm test` | 155 passed, 0 failed/skipped |
| Fresh S178 `npm test` | 208 passed, 0 failed/skipped |
| Literal first-use commands, source and installed | 21/21 exited successfully |
| Documented installed S153 imports | 6/6 passed |

Both archives include all 148 boundary tests. Valid negative/partial examples retain their documented decisions; successful command execution does not invent a business pass.

Source replay from repository root:

```sh
node --test experiments/s137-consumer-evidence-jobs/test/*.test.mjs experiments/s137-consumer-evidence-jobs/src/release-brief/schema.mjs experiments/s178-consumer-repeat-package/test/consumer-provenance.test.mjs
node experiments/s178-consumer-repeat-package/test/acceptance.test.mjs
```

Consumer replay: extract each committed archive into a fresh directory, enter its package root, then run `npm test`. First-use commands remain in S153 README.md and S178 FIRST-USE.md. No parent checkout, dependencies install or rebuild is needed for consumer acceptance.

## Final archives

| Repository path | Bytes | SHA-256 |
| --- | ---: | --- |
| `experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz` | 214024 | `9ad8fd3a8a9d9794b939d93af594c86e420fae33726e177257ff7251b2fa1e58` |
| `experiments/s178-consumer-repeat-package/dist/s178-consumer-repeat-kit.tgz` | 718948 | `04e9b6f382eedd91ae27b0d0faa68abbee7c26a1f06f52e415cb5a5884dfe05d` |

These are rebuilt final bytes, distinct from S211 and the intermediate S220 archive. Two builds matched before commitment. Acceptance extracted bytes read back from the exact Git commit above; no repack occurred during acceptance. Relative regular files/directories only. The final receipt does not alter archive contents.

No remaining scoped test failures. Reproducibility was exercised on native Linux/GNU tar. No model CLI, deployment, payment or account operation. Root owns site integration/release.
