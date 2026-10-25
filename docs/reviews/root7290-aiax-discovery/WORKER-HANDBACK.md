# ROOT7290 source handback

Completed source-only on the admitted writer
`codex/root7290-aiax-discovery-projection-20261025`, canonical origin
`https://github.com/epistemedeus/x402-url-extractor.git`, without rebasing.
Baseline: `e291d41c1f1763e638e2812568290ed176a31c49`.
Implementation commit pushed and independently received by GitHub API:
`cd5d875c94d491eb1a69bd46e5182674253e5080`, tree
`70308a8996f0227d35433d2626afd1fdbbcb3304`.
This handback is a documentation-only successor; the final response supplies its
exact remote HEAD/tree. Root owns receiving and any later machine-only release.

## Delivered and reviewed

Two aliases serve one bounded free JSON manifest, and
`/aiax/sections/extract.json` describes the existing extraction contract. The
adapter uses canonical price, input/output and method/operation identities;
there is no second price setting. Changes to `server.js` are only two imports
of existing capture constants and a guarded optional mount before payment rails.
The adapter performs no external fetch, model call, signing or financial write.
Its missing/bad/oversized source does not prevent existing consumers from starting.

Self-review preserved the existing OpenAPI, other discovery, human rendering,
payment/credential authority, receipts, telemetry classifications and service
version. It added credential-bearing/query-bearing resource URL rejection and
numeric-price rejection, inspected exact output/schema reuse, and broadened raw
human preservation receiving to four pages. Default manifest/section are
**669 / 2,539 UTF-8 bytes**, with hard adapter document bounds **1,200 / 8,192**.
Capture remains **12,000 ms / 3,000,000 bytes / no JavaScript**, excerpt default
**1,200** and maximum **40,000** characters. Cache identity is content-based;
the source revision timestamp does not change on fetch/restart. The required
`est_tokens` is an author estimate, not a measured counter.

Empty trust, null PACT, and the actual existing `/mcp`/`extract` contract are used.
No SCORE, DRS count, partnership, verified status, registration, paid demand,
measured latency, benchmark document or cost-reduction claim was invented.

## Frozen inputs and native receipt

The complete staged assignment and actual owning AIAX qualification section
were read before implementation. Pilot input commit:
`6ace69b7d1f0cabb5a3fcd4dfc261927f2045127`; assignment blob
`49bc9061e06dfafa6260ac464fd76945ac132820`. Input receipt SHA256:
`ad6030094d3f419a53b4783f2fe12a1758d489b3011e41897a0205892728fe1a`.
At admission the five required product members matched the declared baseline; package/lock and
both declared existing suites remain unchanged.

Exact upstream AIAX commit:
`d6bebe40d7aeda29c48b1b2909001717513bb116`. Manifest schema
`c00e8edb358d490813191e7de28d993e577631cf`, section schema
`3c23a0541cddecae880a2ff6856dcfbed8775910`, license
`1c2fb2e74dccbf323aa9534d189569cd888107ba`: copied fixtures were verified by
`git hash-object` against these exact blobs. SPEC
`e9a0a2a1f1c4edc0d5c041ecaec04d8efa45fcc4` and BENCHMARK
`32ca1bcd6b6861817b8af752b2f6eed8affabfe2` were received/read, not copied.
[Implementation note](../../../aiax-discovery/IMPLEMENTATION.md) preserves
SkinGem / Godman Protocols attribution and CC BY 4.0 links. The parsed pricing
regex accepts `0.005`; no upstream repair was made.

Fresh native session: `01a171b2-2118-77d1-8c62-2f8e0d48e0da`.
Actual rollout `turn_context` at `2026-10-25T06:14:23.458Z` records
**gpt-6.1-sol / high**. Native PID 1448094's launch arguments independently
record `-m gpt-6.1-sol -c model_reasoning_effort="high"`.
One parent, **zero model children**, no new model process, credits, overage or
reset. Total reserve **2,097,152 KiB** includes tools/descendants; it is a declared
reserve, not a received hard aggregate cgroup boundary. Node old-space
**512 MiB**, UV **1**, OMP **1**; tests run serially on the admitted Cursor VM.
The test-only preload carries defaults through child environment allowlists.
A real allowlisted-child probe received Node v22.23.3, UV/OMP `1`, old-space
flag `512`, and V8 total heap ceiling `587202560` bytes (includes V8 overhead).
No aggregate peak RSS was measured.

Actual native token checkpoint, **not final totals and not an AIAX benchmark**,
from the session's `token_count` event at `2026-10-25T06:21:41.575Z`:
input **4,286,898**, cached input **4,145,152** (subset), output **22,661**,
reasoning output **7,039** (subset), total **4,309,559**. These are provider/native
counters; no bytes/4 conversion or inferred monetary cost was used.

Local native receipts are under
`/home/ubuntu/root-sol-window100337/root7290-aiax-discovery-projection-20261025/`
(`RUN.json`, `events.jsonl`, `admissions/ecd0514e-3d1a-4fe5-8739-5459d19eed6d/`).
Actual rollout is
`/home/ubuntu/.codex/sessions/2026/10/25/rollout-2026-10-25T06-14-21-01a171b2-2118-77d1-8c62-2f8e0d48e0da.jsonl`.
Checkpoint deadline **2026-10-25T07:40:38.076Z**; this source export precedes it.

## Test commands, exits and original failures

`npm ci --ignore-scripts --no-audit --no-fund`: exit **0**, 244 packages added;
existing lock resolves Ajv **8.20.0** / ajv-formats **3.0.1**. No package/lock or
runtime dependency change. `node --check` for server/adapter and
`git diff --check`: exit **0**.

| Run | Actual command / result |
| --- | --- |
| First focused | `node --test --test-concurrency=1 aiax-discovery/discovery.test.mjs`: exit 1, 5 reported / 2 pass / 3 fail. Test incorrectly expected no ordinary telemetry file and bare `/extract` to return 400. Actual existing behavior records unmatched requests and serves a bare unsigned 402. Corrected the fixture, not product semantics. Dependent assertions also failed after the first assertion. |
| Second focused | Same command: exit 1, 9 reported / 2 pass / 7 fail. Startup `/supported` work overlapped an effect assertion; independently started x402 documents had different existing `lastUpdated` clocks. Remaining failures cascaded from missing captured docs. Waited for actual MCP readiness and fixed the same fixture clock across all compared servers. |
| Third focused | Same command: exit 0, 9/9, zero skipped/cancelled, 6416.162756 ms. |
| Existing suites | `node --test --test-concurrency=1 openapi-exposure-only-aggregate.test.mjs openapi-operation-id.test.mjs paywall-applicability.http.test.mjs extract.http.test.mjs discovery-method-parity.http.test.mjs`: exit 0, 47/47, zero skipped/cancelled, 6279.076671 ms. |
| Optional timing attempt | Combined command prefixed with `/usr/bin/time -v`: exit 127 because `/usr/bin/time` is absent; no tests ran in that attempt. No timing/peak-memory result is claimed from it. |
| Final amended source | `NODE_OPTIONS='--max-old-space-size=512 --import=/home/ubuntu/ae14-work/root7290-aiax-discovery-projection-20261025/aiax-discovery/test-profile.mjs' node --test --test-concurrency=1 aiax-discovery/discovery.test.mjs openapi-exposure-only-aggregate.test.mjs openapi-operation-id.test.mjs paywall-applicability.http.test.mjs extract.http.test.mjs discovery-method-parity.http.test.mjs`: exit 0, **56/56 reported (54 leaves + 2 parents)**, zero failures/skips/cancellations, 12341.767732 ms; stderr empty. UV/OMP inherited as 1 and explicitly carried to children. |

The final run validates exact draft-2020-12 schemas and required field/type
negatives, section identity, a usable required-url request reaching an unsigned
5000-atom offer, canonical default/overridden price, capture limits, GET/HEAD/304,
alias identity, hostile host/query independence, unsupported/malformed sections,
405 behavior and absent benchmark. No discovery-time facilitator request or
financial file change occurred. Ordinary request telemetry remains unmatched.
In the new projection/removal suite, all simulated facilitator traffic was
`GET /supported`, never verify/settle. Existing extraction regressions separately
exercise simulated paid execution against their own loopback fixtures;
external-fetch and extraction tripwires were not triggered by discovery.

Removal tests compare raw bodies/content types against both the physically
absent adapter and exact baseline: OpenAPI, MPP OpenAPI, x402, action catalog,
llms.txt, skill.md, invalid extract response, root HTML, platforms HTML,
methodology HTML and alerts HTML. Only fixture clocks are fixed, consistently;
responses are not normalized. Human source/assets and version are unchanged.

Original logs remain at `/tmp/root7290-aiax-test-{1,2,3}.log`,
`/tmp/root7290-existing-tests.log`, `/tmp/root7290-final-tests.log`,
`/tmp/root7290-final-tests.stderr`, `/tmp/root7290-final-tests.time` and
`/tmp/root7290-npm-ci.log`. Final TAP SHA256:
`0d32a5cfd2d6cf30d910ab6f46f77a2f2814e3ad9761e4e0cf9f3df97ba8df33`.
First/second failure log SHA256s:
`e2dd80c5ab9cdacd492d169abc7ed0d60460b2871a12db2ac647024860b14f9d`,
`88e4ecaff9ae5b0fd4693e2395e8f15c19b0644d50de0366fc9c1312e0c786cb`.

## Cleanup and remaining receiving

All test merchants were terminated and awaited by their own fixture; loopback
facilitators closed and temporary source mirrors/data removed. Actual final
task-scoped process/scratch scan: **0 remaining owned server PIDs, 0 remaining
owned scratch directories**. The task-installed 215 MiB `node_modules` directory
was removed after tests (absent before installation). Test/failure logs remain
for receiving. No browser surface or model child was created. Other jobs and
their processes, account stores and reservations were untouched.

The native parent is necessarily live while writing this handback. Its final
terminal status, final usage and admission reaping/release belong to the existing
supervisor/Root after this turn; they are not falsely reported as completed here.
No deployment, merge, registry check/update, listing/payment, bid/contact,
financial action or provider/account change was performed.

Unexecuted: the upstream independently repeated three-category model/tokenizer
benchmark/transcripts, hosted GET/HEAD receiving and registry readiness. Source
and fixture passes do not establish AIAX conformance, hosted readiness, outside
usefulness, paid demand or revenue. Root next receives exact source/regressions,
then decides release; hosted and registry consumers close that separate boundary.
