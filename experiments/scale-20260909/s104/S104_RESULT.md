# S104 Basepay final delta review

Product head: bc4dd10d40684a7ad5394c7d68eea68024f51c0c
Product tree: b36b922ab16d1e58814c9439efdc9e35c2cf0545
Product branch: codex/s104-basepay-final-20260910
Exact parent: epistemedeus/x402-url-extractor 34a6aab50d08ded73e31cd4ff54e429f06451f4e (S98), composed over S93 3ebf34767213aaa5897bb32232087bcd4ffd5755.
Scope: examples/basepay-composition only; 40 scoped source/fixture files acquired from exact GitHub pin plus the actual imported root stateful-wallet-policy-conformance.mjs. Unmodified scoped blobs checked against GitHub identities. No broad merchant review.

## Direct corrections
- isIndependentlyExecutedHarnessOrigin now grants historical execution credit only to pinned_worker_replay_artifact. separately_labelled_harness_input is still preserved as a caller label, never verified execution. Both layer2.independentlyExecutedHarnessResult and composed evidenceClasses inherit this correction. Known provided/synthetic/caller/replay origins remain distinct.
- Default acquisition now passes each artifact's byte pin to downloadRaw. Actual fetch has redirect:error, AbortController deadline of 15000ms spanning headers/body, incremental stream-size checks before retention, an exact final byte-count check, and cancellation on completion/error. Only HTTP200 accepted. Both existing digest checks still precede each artifact write. No downloaded code execution.
- Help and README explain label versus verification and download bounds.
- Six changed files: src/acquire.mjs, src/evidence.mjs, bin/cli.mjs, README.md, test/cli.test.mjs, test/acquire-bounds.test.mjs, all within examples/basepay-composition.

## Actual native tests
Node v24.19.0.
From examples/basepay-composition:
  node --test test/*.test.mjs
Final: 41 passed, 0 failed, 0 skipped (35 existing + 6 new).
New coverage:
- Actual CLI --harness-result with structurally valid unknown all-pass JSON: label retained, execution/independent tip replay false, no composed independent-harness evidence class, author_claim_only coverage, no layer2 provider-native promotion. Same input through --replay-result retains caller-unverified origin.
- Known origin classification remains stable under caller label. Historical pinned classification is a bounded inherited receipt, not a new harness replay.
- Actual local HTTP exact chunked body, oversized declared length, chunked overflow, truncated body.
- Actual local HTTP stalled headers and stalled body rejected by injected 100ms test deadline; production default 15s.
- Actual local HTTP redirect refusal, zero redirect-target requests, HTTP206 rejection.
- acquireUpstream with its real default downloader (global fetch response fixture only): fixed raw GitHub URL, artifact byte cap, abort/cancel, no output artifact or receipt on first-artifact overflow.
The HTTP fixture server is local; no live upstream, wallet, provider, payment or model calls.

## Dependencies and limits
Example npm ci --ignore-scripts --no-audit --no-fund succeeded with locked agent-payment-policy0.12.0. Root npm ci with the same flags failed on existing Express4 versus mppx0.8.15 optional Express>=5 peer conflict. No lock/manifests changed or peer resolution overridden. For focused runtime, linked installed locked agent-payment-policy0.12.0 and retained Zod3.25.76 (same version as exact root lock) into the isolated scratch root dependency directory.
Root owns Node22/full-root gate; not claimed here. No provider harness execution, pinned upstream download or historical replay artifact reacquisition performed. Optional acquisition/licensing and original synthetic fixture bytes are unchanged. Layer1 observation assertions, layer2 conformance checks, existing provider-native credit rules and refusal of promotion remain unchanged. Prices and payment authority untouched.
No main merge, deployment, comment, spend or production changes.
