# Root adoption

Adopt the reviewed source checkpoint
`b24ece44464302680df93639026ff103126da41a` from
`codex/sol-causal-task-measurement-receiving-100395`, or receive
[export/sol395-source.bundle](export/sol395-source.bundle) with prerequisite
`91fbf94786658c96c89f94e0f88b03caefd951b0`.
[export/sol395-source.patch](export/sol395-source.patch) applies on that exact
base and reproduces the same complete source tree. It changes only339's
projection and these receiving tools. It contains no shared producer, journal
or348 consumer/server edits. The assigned branch's later packet commit adds
receipts, manifests and the separately licensed portable candidate.

Root owns composition with348's final consumer. After its existing authorized
observer obtains a bounded cut, call `exportObserverSource` for the supported
attempt, task-ref, forward, retention/revoke, authorized-read and runtime
settlement planes. Supply exact population, operation, cohort, optional native
task refs, time bounds and real coverage. Use `supported_read_only_export` only
for actual supported cuts; all committed receiving examples are
`synthetic_fixture` because their payment/RPC boundaries are fixtures.

```js
import {
  exportObserverSource, projectObserverEvidence,
} from './task-linked-delivery/experiments/task-demand-100339/src/observer-integration.mjs';
import {
  BUNDLE_SCHEMA, retainReport,
} from './task-linked-delivery/experiments/task-demand-100339/src/project.mjs';

const sources = authorizedCuts.map(cut => exportObserverSource(cut));
const report = projectObserverEvidence({ question, sources });
const callerRetained = retainReport({ schema: BUNDLE_SCHEMA, question, sources }, report);
```

Retain the stripped report with the caller's existing artifact mechanism.
`durationMs` comes from the existing native v3 producer; preserve it in the
authorized attempt export. A partial/torn source, mismatched scope or causal
side keeps its denominator/rate unknown. Never infer tasks from wallet, label,
digest, UA, HTTP200 or aggregate snapshots. Shared authorization/routes remain
Root/348's work. No implicit merchant-directory reader or new measurement
database is introduced.

The portable consumer is
[task-demand-100339-0.1.1.tar.gz](consumer/public/bytes/task-demand-100339/0.1.1/task-demand-100339-0.1.1.tar.gz),
SHA-256 `6cec3a3f4b3f51f485f1bf55688305b83a9fb41bbc34b31f30f6a774ef100cbb`.
Pin both source commit and archive hash. The untouched 0.1.0 export cannot replay
new duration-bearing evidence; its own historical reports remain compatible.
The manifest can be loaded through the existing public-acquisition tools in
isolation. Its URLs are conventions; its receipts establish loopback source
acquisition only.

From a checkout with the repository's exact lockfile dependencies installed,
run the following on the remote receiving host. Publication also needs the
documented `httpx==0.28.1` in an isolated Python path. These tests create their
own temporary journals and never select a production data directory.

```sh
node --test task-linked-delivery/experiments/task-demand-100339/test/*.test.mjs docs/reviews/sol395-causal-task-receiving/receiving.test.mjs
node --test --test-concurrency=1 commerce-outcome-binding.concurrency.test.mjs commerce-outcome-binding.test.mjs commerce-outcome-binding.root.test.mjs commerce-events.test.mjs commerce-settlement-reconciler.test.mjs commerce-settlement-source-delivery.test.mjs task-linked-delivery/receiving.test.mjs task-linked-delivery/experiments/delivery-outcome-100173/test/join.test.mjs task-linked-delivery/experiments/useful-economics-100290/test/join.test.mjs task-linked-delivery/experiments/useful-economics-100290/test/merchant-execution.test.mjs task-linked-delivery/experiments/useful-economics-100290/test/cold-export.test.mjs
node --test machine-acquisition.test.mjs public-acquisition/engine.test.mjs public-acquisition/receiving-lifecycle.test.mjs public-acquisition/receiving-file-bounds.test.mjs
node docs/reviews/sol395-causal-task-receiving/cold-receiving.mjs
```

The publication test generates `public-acquisition/loopback-profile.json`.
Run it in an isolated checkout and preserve/restore its exact prior bytes.
Machine receipts and commands are indexed by [PACKET.json](PACKET.json) and
[evidence/validation.json](evidence/validation.json). Existing339's original
RESULT/PIN/export are retained as historical source evidence.

The remaining decision is useful free-result measurement. Keep it unknown
until an existing producer/consumer authority supplies a native, scoped
delivery/usefulness/read observation without requiring payment. This receipt
provides the real unpaid execution and refusal for that review. Any shared
producer/journal proposal belongs in a focused unapplied patch with executed
regression evidence; this branch applies none.
