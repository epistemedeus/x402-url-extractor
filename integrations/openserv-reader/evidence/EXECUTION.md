# Execution log index

Commands ran serially on the admitted Cursor VM. All paths below are relative
to `integrations/openserv-reader`. No inherited merchant/root installation ran.

| Command / phase | Exact output | Result |
| --- | --- | --- |
| Isolated `npm install --ignore-scripts --no-audit --no-fund` | `install.log` | 206 packages, exit 0 |
| `node materialize.mjs` | `materialize.log` | 7 modules, 8 dependency pins verified |
| First `node receive.mjs` | `first-run.log`, `first-installed-consumer.json`, `first-proof.json` | 9 pass, 2 fail; retained original |
| Corrected `node receive.mjs` | `review-run.log` | 13 pass, 0 fail |
| Isolated `npm ci --ignore-scripts --no-audit --no-fund` | `clean-install.log` | 206 packages, exit 0 |
| Optional `/usr/bin/time -v node receive.mjs` | `missing-time-tool.log` | command unavailable, exit 127; no test dispatch |
| Source/unknown-error refinements `node receive.mjs` | `pre-restart-run.log` | 14 pass, 0 fail |
| Durable-new-instance refinement `node receive.mjs` | `pre-golden-run.log` | 15 pass, 0 fail |
| Final `node receive.mjs`, including independent Unicode golden | `final-run.log`, `final.tap`, `final-stderr.log` | 15 pass, 0 fail, 0 skip, exit 0 |

The isolated install environment was:

```sh
env -i PATH="$PATH" HOME=/tmp/root55500-install-home \
  npm_config_userconfig=/dev/null \
  npm_config_cache=/tmp/root55500-install-home/cache \
  npm ci --ignore-scripts --no-audit --no-fund
```

The actual final test command and timestamps are in `installed-consumer.json`.
The receiver creates its own separate HOME/env, copies the installed consumer,
verifies every core hash, package version and SDK archive member, runs the tests
with test concurrency 1, snapshots all installed files again and removes its
temporary consumer. `installed-files.json` is its complete before inventory.
`proof.json` contains the final full record pairs, calls and cleanup facts.

Registry/archive verification is in `sdk-source.json`; installed SDK raw-file
comparison is `sdk-installed.json`. `inputs.json` and `source-receiving.json`
bind all frozen input roles. The SDK official source excerpts/registry response
are retained in `../upstream/`, and dependency notices in `../notices/`.

The initial full diff whitespace check reports original distributed notice and
raw failure-log whitespace (`diff-check-original.log`). Subtree attributes
exclude those byte-exact inputs/logs from whitespace normalization. Authored
code/docs remain checked; the final staged `git diff --check` passes.
