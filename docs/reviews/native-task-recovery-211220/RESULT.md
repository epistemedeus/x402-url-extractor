# Native task recovery 211220 result

**Disposition: release-ready shared candidate.** The exact 211210 mount is on the owning `server.js`. A lost reply on that server keeps one facilitator verify and one facilitator settle. Ordinary paid MCP calls that omit `payment.resource` still execute, and a repeat of the same credential is a retained replay.

Pins checked before editing. `origin/master` is still `32267493d29ff1339c5199185d8231012daf0acd`, tree `24ce30d298a375e8b993ac29218b8540d1fb7de7`. Initial export `686bf94d127172cd8dcf3fdc9441dbed8d7899de`, tree `7e51416c27bd3d74f0da108504551c9d0c0c22ce`, was ahead 4 and behind 0 of that master. Executable source `18bd473162b2795b80ee9b98ef5731bdabad7072`, tree `fc086b705e1c7e8ce226110001ba1f089fbca87e`. Carrier `3b5914cf0583bd92db9d9f5b2936f03bda09417f` remains `origin/codex/sol-structural-211200`. Pilot context `8b68ef35107223f9098c629c5bf8a5b96b011edb` is untouched. The 211200 and 211210 review directories are unchanged.

Integration commits, each a child of the previous, on `cursor/pilot-211210-complete-task-recovery-receiving-702e`:

| Commit | Tree | Change |
| --- | --- | --- |
| `4647868e0485a4071cf0d73e7f681b393e1a7adf` | mount line, default suites, tool-list +1 | `SHARED-MOUNT.patch` applied to the owning tree |
| `0e5cc789c709304a8d842e17021dab819356fe80` | `8d9dc11b988268b957075d3ccd2b1a5f3d4edead` | ordinary payments without `resource.url` bind to the invoked tool |
| `dcb9a79155368207275b4c1e40e0a897c2fce467` | `8fef415c2a8f65e0479c6d9bb040e9f094218655` | unpaid discovery skips the journal |
| `48d255890c6facec79dcef0c655214fd530cb2fc` | `0c5596b7ebafd4963c13b7d401fcd6c37353bc8e` | a repeated credential is `replay_success` with no second verify or settle |

This review is the child of `48d255890c6facec79dcef0c655214fd530cb2fc`. [Pins and hashes](SOURCE.json).

Run `bc-90382a85-b84f-45c9-a660-87044b71adff` at https://cursor.com/agents/bc-90382a85-b84f-45c9-a660-87044b71adff. `run-info` recorded `originalModelName` `grok-4.7`, source `api`. The admission selected Cursor Grok 4.7, effort xhigh, 256k, Fast false. The run record has no effort, Fast, or `chargedCents` field, so those three stay unknown.

Runtime is SHA-verified Node v22.23.3 (`df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de` for `node-v22.23.3-linux-x64.tar.xz`). httpx 0.28.1 was used only from `/tmp/native-task-recovery-211210-runtime/python-deps`. The acquisition test and dependency manifest were left unchanged.

## Pre-fix and mounted output

Unmounted `docs/reviews/native-task-recovery-211200/reproduce.mjs` on preserved `server.js`, before the patch, exited 1. [Log](evidence/unmounted-before.log): verify 2, settle 2, journal entries 0, decision `attempt`, assertion `2 !== 1`.

After the mount, the same unmodified script on the real `server.js` exited 0. [Log](evidence/mounted-reproduce.log): verify 1, settle 1, one journal entry, decision `attempt`. `readOnlyResume` is false because that script's second call is another paid `tools/call` replayed by the journal. The free read is the harness below.

[Harness](mounted-receive.mjs) boots the owning `server.js` with `PUBLIC_URL=https://agents.samedaydesk.com` and dials loopback. [Receipt](evidence/mounted-receive.json): 23 paid tools, 26 listed tools, only added tool `recover_paid_result`. Lost reply, process `SIGKILL`, restart, same task/tenant/principal/endpoint/grant/terms/input. Output deep-equals free `opportunityPreflight` (`decision` `attempt`, `expectedSurplusUsd` 7). Free read after restart, local read with the server down, widened/revoked/expired grant refused, wrong tenant refused, replacement nonce refused, changed input refused. Identical credential replay keeps settle at 1. Missing and malformed captures are `isError`. Unknown settlement stays unresolved, `settlementAttempted` true, `possibleAtomic` `50000`, `remoteStopped` and `refunded` `unknown`, second settlement false. `paidLiveCalls` 0. `chainTransfersObserved` 0. Facilitator settle counts are attempts, not chain transfers. Owner QA is not customers or revenue.

## Integration repairs

The first mounted default `npm test` exited 1: 1157 tests, 1149 pass, 4 fail, 4 skip. [Log](evidence/default-npm-test-before-binding.log).

1. `recover_paid_result` is free. Paid-action parity now ignores it and still fails an unknown name such as `circle_gateway`. Static `listMcpToolMetadata()` does not list the runtime tool. Live `tools/list` asserts the free tool once, `charged` false, `paymentRequired` false.
2. Ordinary SDK payments omit `payment.resource`. The journal was refusing them before the handler, so the existing capability seal never ran (`capability_absent`, `hook_capability_absent`). A missing resource now binds to the invoked tool name. An explicit resource that names another tool still returns `recovery_binding_rejected`.
3. Unpaid `tools/call` entered `mcpBinding` before the payment bypass. `JSON.stringify(undefined)` threw and the challenge became `recovery_scope_rejected`. Unpaid discovery now returns to the existing wrapper first.
4. Resending the same morpho credential kept settle at 9 when the old test expected 10. That hold is the mount. Typed telemetry records `replay_success` with `handlerInvoked` false and does not add another `paid_success`. [Focused morpho log](evidence/regression3.log) and the later default suite both pass.

## Gates

Unmodified `npm test` at default concurrency, Node 22.23.3, `PYTHONPATH` for httpx. No `--test-concurrency=1`.

| Gate | Result |
| --- | --- |
| pretest | 19 pass, 0 fail, `duration_ms` 62.215693 |
| `npm test` | 1158 tests, 1154 pass, 0 fail, 4 skip, exit 0, `duration_ms` 115132.439006 |
| `npm run test:nonlive` | 194 pass, 0 fail, exit 0, `duration_ms` 7857.282511 |
| focused journal, caller recovery, MCP recovery, HTTP replay | 57 pass, 0 fail, exit 0, `duration_ms` 21521.669007 |

The four skips stay named: "deployed extract advertises machine documentation"; "official offline validator accepts exact commit package when pin is supplied" (`Set XAGT_PLUGIN_ROOT to the clean official pin for this gate`); "sidecar detects a skip-worktree modification to the official validator" (`Official validator checkout not supplied`); "unpaid initialize-era initialize and tools/list require extract and extract_batch".

Pretest gained the free-tool parity case (18 to 19). The default script gained the ordinary-payment case inside `idempotency-replay.test.mjs` (1157 to 1158) plus the two recovery files already added by the mount patch. Focused 56 became 57 for that same ordinary-payment case. `test:nonlive` stayed 194. The suite rewrote `public-acquisition/loopback-profile.json`. Original sha256 `e9a6d955f9073eb92b3aaf2333a1f3c2f28437d74801f73613479735a48488c8` was restored. Published caller archive manifest sha256 `62f82d80bdc5f82a0706990afb8040331f9e04d2f66dabdcad00bcb6c5af0f19` is unchanged. No new paid product or client archive was built.

## Next command

No merge and no deploy were performed. Root reviews the financial and authority source and decides deployment.

Rollback on this branch, without resetting history:

```bash
git revert 48d255890c6facec79dcef0c655214fd530cb2fc dcb9a79155368207275b4c1e40e0a897c2fce467 0e5cc789c709304a8d842e17021dab819356fe80 4647868e0485a4071cf0d73e7f681b393e1a7adf
```

After Root deploys this candidate from the complete Git checkout with the existing lockfile, an anonymous unpaid `tools/list` against the public MCP URL is the live check. It was not run here.

```bash
node --input-type=module -e '
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const client = new Client({ name: "anonymous-recovery-list", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://agents.samedaydesk.com/mcp")));
const tools = (await client.listTools()).tools;
const recovery = tools.find((tool) => tool.name === "recover_paid_result");
console.log(JSON.stringify({
  listed: tools.length,
  recovery: Boolean(recovery),
  charged: recovery?._meta?.samedaydesk?.charged ?? null,
  paymentRequired: recovery?._meta?.samedaydesk?.paymentRequired ?? null,
}, null, 2));
await client.close();
'
```

Flag-off startup still logs 23 paid tools. The listed set should include `recover_paid_result` once, with `charged` false and `paymentRequired` false. The feature-source consumer remains `caller-result-client/bin/recover-mcp.mjs` against that same advertised `https://agents.samedaydesk.com/mcp` endpoint. The published 0.1.0 archive does not gain a new client.

## Remaining limits

The signed deployment statement requires `PUBLIC_URL` to be `https://agents.samedaydesk.com`. A loopback `PUBLIC_URL` exits before listen. The ordinary CLI dials `endpointUrl`, so a loopback socket cannot satisfy that advertisement. The mounted harness injects a loopback client while the library endpoint string stays the signed public MCP URL. A separate CLI spawn at the loopback URL refuses `recovery_endpoint_or_tenant_rejected` before verify or settle.

`loadGrant` stays application authority. One provider process owns the journal directory. httpx 0.28.1 stays an external `PYTHONPATH` for the acquisition test. Settle counts are facilitator fixture attempts. `chainTransfersObserved` is 0. These fixture receipts do not establish price, speed, demand, customers, or revenue.
