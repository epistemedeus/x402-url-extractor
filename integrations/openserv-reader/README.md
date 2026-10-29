# OpenServ offline reader contract proof

Source-only Stage 1 experiment. The installed `@openserv-labs/sdk@2.4.1`
subclass overrides its protected `doTask` seam and uses the existing licensed
reader. It never provisions resources or invokes a model. The direct reader
already supplies the extraction result. The proposed adapter value is platform
task integration and distribution; this experiment establishes neither outside
use nor a free hosted tier.

Product base: `epistemedeus/x402-url-extractor@7c03b0b511c5e84a3d2dc856b4ae6d527e5bead7`,
default `master`. Sole writer: `codex/root55500-openserv-offline-reader-20261029`.
Only this subtree belongs to the experiment.

## Exact profile

Tested on Linux x64, Node **22.14.0**, npm **10.9.7**. No transpiler, browser,
Python, merchant installation, external model, or OpenServ account is needed.
`package-lock.json` freezes all 206 installed dependency packages. Lifecycle
scripts are disabled. Direct dependencies:

| Package | Version | Purpose |
| --- | --- | --- |
| `@openserv-labs/sdk` | 2.4.1 | Actual Agent, router, authentication and task APIs |
| `openai` | 5.5.0 | SDK's required peer, matching its source lock; imported, never called |
| `zod` | 3.25.76 | Reader schema and strict local envelope validation |
| `@exodus/bytes` | 1.16.0 | Existing reader decoding |
| `htmlparser2` | 12.0.0 | Existing reader table parsing |

SDK source is [28b3b2a2651139099f8d41cfc1e2a8b57d54c6ee](https://github.com/openserv-labs/sdk/tree/28b3b2a2651139099f8d41cfc1e2a8b57d54c6ee),
MIT. Registry SHA-512, source archive SHA-256, exact source excerpts and license
are received in `upstream/` and `evidence/sdk-source.json`. All 27 installed SDK
files match the registry tarball byte for byte. `DEPENDENCIES.json` records the
complete installed package/source/integrity/notice closure.

`materialize.mjs` verifies and copies the seven unchanged modules from the
existing public `../olas-reader/reader-core` into `.runtime/reader-core`.
Their original source is product `38f8787b04bf3221ee0875ce1a6af687592c8015`.
All eight reader dependency versions/integrities remain identical to that
carrier. No Python component is imported. The MIT reader license and the
original source/hash manifest accompany this package. Generated code is never
edited. Receiving verifies its exact hashes again before execution.

## One local invocation

From a checkout containing this subtree and the existing Olas reader carrier:

```sh
cd integrations/openserv-reader
proof_home=$(mktemp -d)
env -i PATH="$PATH" HOME="$proof_home" npm_config_userconfig=/dev/null \
  npm_config_cache="$proof_home/cache" npm ci --ignore-scripts --no-audit --no-fund
node materialize.mjs
node receive.mjs
rm -rf "$proof_home"
```

The finite receiver copies an explicit file list, the verified core and this
profile's installed dependencies to a fresh temporary consumer. Tests run there
with a new HOME and an allowlisted environment. They borrow no root-package
dependencies. Provider and source servers listen on `127.0.0.1`; test network
guards reject external connections in both the consumer and fixture readers.
The reserved `https://fixture.example` names map only to the owned local source
server. They are synthetic sources. No DNS lookup or live read of those names
occurs. Exact test logs, full useful-output pairs, transport calls and the
complete before/after installed-file inventory are written under `evidence/`.

The invocation exits and closes its servers and children. To stop an active
receiver, press **Ctrl-C** in its foreground terminal. It signals only its own
new test process group. To remove generated dependencies/core afterward:

```sh
rm -rf node_modules .runtime
```

## Input and authority contract

This is a deliberately narrow **synthetic** subset of the pinned
`DoTaskActionSchema`. The source supports `task.input?: string` and
`explicitInput?: unknown`; it has no top-level `action.input`. This fixture
protocol accepts only `task.input` containing JSON with exactly
`{"url":"https://fixture.example/matrix","maxChars":40000}`.
It requires the source's task/workspace/assignee fields, empty contextual
collections, and an explicit workspace execution ID. Other shapes, including
`explicitInput`, are refused. The encoding is our local choice, not evidence of
a captured or supported hosted trigger input.

The constructor requires an expected account label, agent ID, workspace ID,
task ID, execution ID and agent-specific synthetic credentials. The SDK performs
its actual bcrypt authentication using `x-openserv-auth-token`. The fixture's
provider verifies the synthetic agent key and exact expected task routes.
There is no account ID in the pinned action/task-detail contract: this local
key/account mapping does not prove hosted account ownership.

Strict validation happens before a source request or task mutation. A task read
must additionally match the expected assignee, task input, task ID and
`in-progress` status. Prompts, HTML, URLs, workspace text and input cannot select
credentials, headers, task authority, payment, wallet, MCP configuration or
child arguments. The child receives a fresh environment without the SDK key.

The adapter uses the installed SDK's router, authentication and task methods.
It constrains the pinned implementation's `app.listen` call to loopback, since
the SDK has no host option. Its root handler awaits the override and returns a
local receipt. The SDK's ordinary root handler would acknowledge asynchronously.
Non-root SDK routes are refused. These narrow implementation dependencies must
be reviewed before changing the SDK pin; receiving refuses source/pin drift.

## Results and recovery

Reader records retain their original 13 fields and schema, including true
`fetchedAt`. A 403 record still has `ok:true`, `sourceOk:false` and `http_403`.
Malformed/unsafe tables preserve omission and truncation; source/body/output
limits remain unchanged. The real source deadline is 12 seconds, with a
14-second child watchdog. Explicit cancellation kills and reaps that task's
reader child. Neither path fabricates a reader record.

One fixture file retains the original scope/action before execution, then
fsyncs the original serialized reader result before the only completion PUT.
It is local test evidence, owned by a single adapter instance, not a financial
ledger or a distributed execution claim. Duplicate/concurrent delivery never
repeats source execution. New-instance recovery uses the same retained bytes. Scope identity compares the fixed account/agent/workspace/task/execution fields, independently of object-key order. An existing matching journal keeps its original filename and bytes until ordinary recovery updates its state. Multiple matching originals refuse rather than select one. This still provides no interprocess exclusion.

Only the SDK's original-task GET `/detail`, PUT `/complete`, and POST `/error`
are permitted. Lost completion acknowledgement causes readback of the original
task. Acceptance requires `done`, the expected task/assignee and an exact output
string match. Missing, differing or unreceived output remains unknown. Recovery
never repeats execution, PUT, source fetch or any charge. An acknowledged PUT
is labelled an acknowledgement, separately from matched readback.

The detail type has no original-error field. Lost error acknowledgement cannot
establish that exact error and remains unknown, without repeating POST.
Process death during execution likewise leaves an unknown original; it does
not authorize execution again. Source failures do not become successful reads.

## Limits

No OpenServ account, credits, workflow, agent, key creation, deployment, tunnel,
wallet, signer, paid/trial merchant route, `/runtime/execute`, `/generate`,
`process()` or external inference was used. Full provider-call assertions cover
failure and recovery as well as completion. The inherited OpenAI/MCP modules
are declared SDK dependencies; they are not configured capabilities.

Hosted envelope wiring, scheduling/shadow-model costs, credit expiry/debits,
negative balance, private access, buyer projection, settlement and retirement
remain unqualified. Before any later hosted test, Root needs the actual
supported envelope and separately received zero-cash terms. The original
canonical-GET wrapper remains STOP and issue 6 remains on its maintainer boundary.

The TLS check uses the unchanged production fetch with an injected certificate
error and inspects the preserved Node verification defaults. It does not claim
a live TLS handshake. Complete byte equality separately binds the production
fetch to the qualified source. Total native workload peak RSS remains unknown;
2 GiB is the admitted serial workload estimate, with the 2 GiB host reserve
unchanged.
