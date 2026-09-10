# S128 result

Reviewed input: `b40f5c94f2c8631fa509675f92ce16aaf7395fb5`.
Composition parent/current master: `1a23b648e3c5f90bc009accb85972e2db6e22051`.
Reviewed product commit: `c10fee3ff783d56b42887b478e0263112d072293`.
Exact tested product tree: `cb8e8ea38ce43b5527404816b44309809987062c`.
The final branch adds this receipt separately. No generated packet/archive or raw transcript is exported.

Fixed exact commit/review-label binding; disabled mutable-worktree proof packaging; ignored local Git object replacements; rejected symlinks, nonportable paths and colliding names; imposed source budgets; preserved file modes; refused existing output and symlink parents. Pinned all eight vendor files including the local index and NOTICE. Manifest hashes cover every included byte and enumerate exclusions. The builder never signs RIGHTS.md or asserts live deployment.

The sidecar now checks actual validator bytes, including when Git skip-worktree hides a change, and explicitly labels its result offline-only. Missing official checkout is an explicit test skip; a supplied wrong/dirty checkout fails. Health/proof retain exact deterministic slug/commit fields and reject mismatched host/local pins. Test-only NETWORK is fixed to the fixture chain, without altering production validation, prices or payments.

Executed native Linux: Node v24.19.0, npm 11.9.0. Installed existing locked dependencies with `npm ci --ignore-scripts --no-audit --no-fund`. All 39 focused + 11 mounted tests passed, no skips, including actual official validator `xagentAI/xagt-plugin@422f0aeb5520a3506b08b05cfefcb76c6cb786c0`. Replayed the combined 50-test gate on the exact exported product commit. The official checkout stayed clean. No nested model, paid call, live merchant operation or deployment.

Commands from the complete product checkout:

```sh
XAGT_PLUGIN_ROOT=/path/to/clean/xagt-plugin node --test page-change-http.test.mjs extract-batch-page-change.test.mjs page-change-xagent-package.test.mjs page-change-http.mounted.test.mjs
node scripts/page-change-xagent-package.mjs --commit c10fee3ff783d56b42887b478e0263112d072293 --out /tmp/samedaydesk-page-change
XAGT_PLUGIN_ROOT=/path/to/clean/xagt-plugin node scripts/page-change-xagent-sidecar.mjs /tmp/samedaydesk-page-change
```

Use a fresh output directory whose existing parent is not a symlink. Actual local packet validation passed with 486 included files and eight checked vendor files. Its source-only HTTP suite passed 27/27 without node_modules; the literal page-change compare command returned unchanged with fresh=false. These repeat existing tests, not additional distinct tests. Deterministic duplicate builds and every included source hash were checked by regression.

Archive boundary: the official filter omits `service-deployment-ed25519-public.pem` and `commerce-settlement-source-delivery.test.mjs` (a synthetic secret fixture triggers the scan). The offline page-change implementation, worker, fixtures and vendor/change-digest are self-contained. The filtered packet is NOT a complete bootable merchant checkout or a root-suite artifact. Original instructions incorrectly offered full server startup and described the extract-batch integration test as standard-library-only; both claims are corrected. Full deployment uses the complete owning checkout with its public key and locked dependencies. No blocked asset is renamed to evade the validator.

Initial failures retained: the pre-install focused run failed importing zod; resolved by installing the existing lockfile. The initial mounted run failed 10/10 at startup because Work's inherited NETWORK=caas_ingress_only is not a payment chain. An explicit fixture chain repaired only the test harness; 11/11 then passed, including the new mismatched-header/proof regression. No service validation was weakened.

Later operator deployment: preserve all existing merchant configuration and prices; set PAGE_CHANGE_HTTP_ENABLED=1 and PAGE_CHANGE_XAGENT_SLUG=samedaydesk-page-change. Use Railway's actual RAILWAY_GIT_COMMIT_SHA or a pipeline-derived SOURCE_COMMIT. Leave manual PAGE_CHANGE_SOURCE_COMMIT/PAGE_CHANGE_XAGENT_COMMIT unset; if present they must agree. Rebuild for a new composition commit rather than relabeling source. Read health and the well-known proof: require healthy status, matching exact commit in both bodies and both x-source-commit headers, schemaVersion=1 and exact slug. These environment strings are assertions, not signed attestations.

Remaining: root Node22/full-suite composition and any authorized actual deployment/public readback. No online official validation, rights signature, contest submission, award/eligibility proof or spend was performed.

Product-only paths: examples/customer-x402/README.md; package.json; page-change-http.mjs; page-change-http.mounted.test.mjs; page-change-http.test.mjs; page-change-xagent-package.test.mjs; scripts/page-change-xagent-package.mjs; scripts/page-change-xagent-sidecar.mjs. Everything else in master is preserved.
