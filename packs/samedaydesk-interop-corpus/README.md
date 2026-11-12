# samedaydesk-interop-corpus

A maintained SameDayDesk interoperability corpus for the free page-change MCP
profile (`POST /mcp/page-change`, tool `compare_page_observations`, protocol
2025-11-25). Each case is a retained failure with its original author,
allowed publication, fixture provenance (repo, commit, path, git blob), source
versions, and earlier negative preserved. It ships with an adapter that runs
the official MCP conformance runner and classifies every check against the
recorded profile.

Private package. No npm publish, payment, signing, or live merchant change.
Results are baseline-relative. Exit 0 is not universal conformance and not a
certification claim.

## Pins

| What | Pin |
| --- | --- |
| Official runner | `@modelcontextprotocol/conformance@0.2.0-alpha.12`, gitHead `f44482ba17df816d3176962a11cdf36aec9bda00`, devDependency pinned exactly, lockfile included |
| Requirement sets | `requirements/2025-11-25.yaml` (stateful initialize wire), `requirements/2026-07-28.yaml` (stateless wire, server/discover) |
| Changed implementation | `samedaydesk-capability-compat@0.1.0` at `c060afcd1419cafff69d3e568ae7fc3d163c79b0` |
| Merchant | `e90676f48da875c5e0f475f57f7774de947b75a7`, service 1.23.55, sdk 1.32.2, client 2.4.0 |

`0.1.16` (npm `latest`) is not used: it has no requirement sets and no
2026-07-28 wire. See `PIN.json`.

## Corpus

| Case | Fault surface | Earlier negative | Changed implementation |
| --- | --- | --- | --- |
| CK-N12-001 | unknown-tool recovery mapper vs sdk 1.x message prefix | known_failure, 4/6 at b38dc14b | successful |
| CK-N12-002 | explicit 2026-07-28 pin | unsupported, ERA_NEGOTIATION_FAILED at 53069cfc | successful (2025-11-25) |
| CK-N12-003 | merchant sdk 1.30.0 to 1.32.2 | known_failure, sha-only detection at 967ec6a2 | successful (reconnect) |
| CK-N12-004 | merchant service 1.23.54 to 1.23.55 | known_failure, sha-only detection at 967ec6a2 | successful (re_pin) |

`corpus/SKIPPED.json` lists candidates left out and why. `corpus/residuals.json`
lists only the pairwise and fault behavior the official runner does not cover
here (R-01 client SDK line vs message shape, R-02 refusal code, R-03 Tasks
declared on 2025-11-25), each with its named consumer and test.

## Outcome classes

`classifyCheck` maps each official-runner check to one of:

- `successful`: the check passed.
- `known_failure`: a failing check that matches a corpus case's `runnerMatch`.
- `unsupported`: the profile declares it does not serve the wire or extension
  (2026-07-28, Tasks).
- `not_applicable`: outside the stateless single-tool free profile (fixture
  tools, logging, completions, resources, prompts, SSE streams), or a runner
  SKIPPED or INFO check.
- `harness_failure`: runner crash, timeout, unparseable or missing
  `checks.json` on a served wire, wrong runner version, or a runner harness
  check.

A failure that fits none of these is `unexplained_failure`. It is never
excused: a FAILURE blocks the run. The runner's own exit code is recorded but
is not the verdict, because refused 2026-07-28 scenarios fail by design.

## Use

```bash
interop-corpus cases
interop-corpus conformance --url http://127.0.0.1:PORT/mcp/page-change --out ./runner-out --report report.json
interop-corpus classify --results ./runner-out --report report.json
```

The consumer `samedaydesk-capability-compat-consumer` installs this package
from its tarball and replays every case against the changed implementation
(`replayCorpus`).

## VM run

`scripts/vm-run.sh` packs both tarballs, installs the pinned runner with
`npm ci`, checks its version and entry sha256 against `PIN.json`, runs the
focused tests, starts the test-only loopback page-change server, runs the
official runner for both requirement sets through the adapter, and prints the
classified totals with all shas.

`fixtures/runner/server-legs.synthetic-shape.json` is a synthetic-shape fixture
built from the runner's `ConformanceCheck` type at the pinned gitHead. It was
not produced by running the runner. The VM run produces the real output.
