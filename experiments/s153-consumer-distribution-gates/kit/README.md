# S137 consumer-evidence kit (jobs 01–06)

Offline kit for six cited consumer-evidence artifacts. Pin: `361460288e96d43da2f215e158fad96745507fde`. Node 20+. No `npm install` of runtime dependencies. This CLI never fetches, pays, or publishes.

Jobs **07/08** are out of scope. See `COMPAT-07-08.md`.

## Install (clean tree, no registry)

From the repository root:

```
tar -tzf experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz
mkdir -p /tmp/s137-consumer-kit
tar -xzf experiments/s153-consumer-distribution-gates/kit/dist/s137-consumer-evidence-kit.tgz -C /tmp/s137-consumer-kit --strip-components=1
```

Build the archive first if `kit/dist/` is empty:

```
node experiments/s153-consumer-distribution-gates/kit/scripts/build-archive.mjs
```

In-repo (no unpack):

```
node experiments/s153-consumer-distribution-gates/kit/bin/cli.mjs --help
```

## CLI (literal)

From an unpacked kit directory:

```
node bin/cli.mjs --help
node bin/cli.mjs list
node bin/cli.mjs analyze migration-checklist --in examples/migration --clock 2026-09-10T12:00:00.000Z
node bin/cli.mjs analyze release-brief --in examples/release-brief --clock 2026-09-10T12:00:00.000Z
node bin/cli.mjs analyze table-reconcile --in examples/table-reconcile --clock 2026-09-10T12:00:00.000Z
node bin/cli.mjs analyze link-index --in examples/link-index --clock 2026-09-10T12:00:00.000Z
node bin/cli.mjs analyze replay-pack --in examples/replay-pack --clock 2026-09-10T12:00:00.000Z
node bin/cli.mjs analyze freshness-receipt --in examples/freshness --clock 2026-09-10T12:00:00.000Z
node bin/cli.mjs analyze --all --clock 2026-09-10T12:00:00.000Z --in-root examples
```

From the repository (same flags, pack CLI):

```
node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs list
node experiments/s137-consumer-evidence-jobs/scripts/cli.mjs analyze migration-checklist --in experiments/s137-consumer-evidence-jobs/fixtures/real/migration --clock 2026-09-10T12:00:00.000Z
```

`--clock` is required for `analyze` (operator ISO-8601; do not invent). `--in` must be a local path. `http(s)://` is refused.


Real `examples/` may return `pass`, `partial`, or `fail` with cited findings. That is expected for offline sourced snapshots; the CLI still exits successfully with `ok: true` and does not invent a pass.

## Programmatic import

```
import { transform } from "s137-consumer-evidence-kit/migration-checklist";
import { transform as brief } from "s137-consumer-evidence-kit/release-brief";
import { transform as tables } from "s137-consumer-evidence-kit/table-reconcile";
import { transform as links } from "s137-consumer-evidence-kit/link-index";
import { transform as replay } from "s137-consumer-evidence-kit/replay-pack";
import { transform as freshness } from "s137-consumer-evidence-kit/freshness-receipt";
```

In-repo equivalent (no install):

```
import { transform } from "./experiments/s153-consumer-distribution-gates/kit/src/migration-checklist.mjs";
```

I/O contracts: `manifests/01.json` … `manifests/06.json`. License pins for `examples/`: `LICENSE-PINS.md`.

## Non-claims

- Offline deterministic transforms only.
- No paid endpoints, legal attestation, model-as-oracle, or customer-demand claims.
- Missing or conflicting sources stay `unknown` / `partial` / `conflict`, not invented `pass`.

## Release-brief conflict regression (S174)

Synthetic case envelopes must unwrap to schema input. SHA mismatch must not become `pass`:

```
node bin/cli.mjs analyze release-brief --in examples/release-brief/conflict-sha-mismatch.json --clock 2026-09-10T18:00:00.000Z
```

Expect `decision=conflict` (not `pass`). Positive/partial controls:

```
node bin/cli.mjs analyze release-brief --in examples/release-brief/positive-aligned.json --clock 2026-09-10T18:00:00.000Z
node bin/cli.mjs analyze release-brief --in examples/release-brief/partial-announced-only.json --clock 2026-09-10T18:00:00.000Z
```

## Installed package tests

```bash
npm test
```

Runs all 148 portable input-boundary tests and checks the actual package manifest,
source pin and runtime file digests in `CONSUMER-PROVENANCE.json`. These local
integrity checks do not attest to a live server version or an external release.
Archive building is a repository command; the installed package has no build script.
