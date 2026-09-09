# Merchant RC — S33 compose 2026-09-09

`execute:false`. Proposed operator commands only. **Do not run** deploy, rollback, `railway up`, `git push origin master`, live payment, or `mcp-publisher publish` from this job.

Feature branch only: keep this file on `codex/s33-release-compose-20260909`. Product runtime to ship is S25 rare-funnel, not this notes file.

## Pins

| Item | Value |
| --- | --- |
| Repo | `epistemedeus/x402-url-extractor` |
| Branch | `codex/s33-release-compose-20260909` |
| Product RC SHA | `7da07c15bcdcf23256b8e2790641a36367d2ebf1` |
| Product RC tree | `b4b8e8cd315b1b92564f0665837429cff2923f2c` |
| Rollback SHA (`origin/master`) | `f9dd59aeeb200881bc1313ed846ba002e7081258` |
| Rollback tree | `89f476cfa1790a3692f6a070f96c49f8940f305b` |
| Package / MCP version | `1.23.45` (unchanged vs live; **not** a deploy discriminator) |
| NETWORK | `eip155:8453` |
| Railway project | `39cd108e-7036-40cd-97a7-8a86efa1cfd0` (`x402-url-extractor`) |
| Railway environment | `02b78d43-d0f3-48b0-91ed-a2763ef8d2bd` (production) |
| Railway service | `1c51e546-ce5f-4d54-9ff9-ef9603674b01` (`x402-url-extractor`) |
| Volume | `e4fdd92e-66fc-4937-858a-a1fff9b7d31e` at `/data` (keep; do not recreate) |

S25 delta vs master: `commerce-events.mjs`, `commerce-events.test.mjs`, `commerce-rare-funnel.mounted.test.mjs`. Adds public `durableRareFunnel` on `/v0/commerce-demand.json` (`samedaydesk.commerce-rare-funnel-evidence.v1`, `rare_funnel_capture_v1`, reset `append_until_rare_byte_rotation; no_historical_backfill; stream_rotation_independent`). No route, price, wallet, x402/MPP, or `EXTRACT_BATCH_ENABLED` change.

Live 2026-09-09T19:53Z (credential-free): MCP `1.23.45`, 23 paid tools including `extract_batch`, `NETWORK=eip155:8453`, commerce-demand **lacks** `durableRareFunnel`. Keep production batch enabled.

## Local proof (already run; non-live)

```bash
cd /workspace/s33-src/x402-url-extractor
NETWORK=eip155:8453 node --test commerce-events.test.mjs
NETWORK=eip155:8453 node --test commerce-rare-funnel.mounted.test.mjs
node --test merchant-rc.test.mjs
```

Expect 91 + 1 + notes tests, exit 0. Skip `:live` scripts. No payment.

## 0. Capture rollback checkpoint

From the **linked production** merchant worktree. Require these IDs before any later command. Do not print unfiltered project JSON.

```bash
railway status --json | jq -c '
  .environments.edges[].node.serviceInstances.edges[].node
  | select(.serviceId=="1c51e546-ce5f-4d54-9ff9-ef9603674b01")
  | {serviceId,serviceName,latestDeployment:{
      id:.latestDeployment.id,
      status:.latestDeployment.status,
      commitHash:.latestDeployment.meta.commitHash,
      imageDigest:.latestDeployment.meta.imageDigest,
      createdAt:.latestDeployment.createdAt
    }}'
```

Record `PRE_DEPLOY_ID`, `PRE_DEPLOY_COMMIT`, `PRE_DEPLOY_DIGEST`. Also:

```bash
git rev-parse HEAD
git rev-parse 'HEAD^{tree}'
# rollback tree must stay 89f476cfa1790a3692f6a070f96c49f8940f305b until this RC is merged
```

## 1. Proposed deploy (operators only; do not run here)

Source-derived GitHub autodeploy of **product** SHA `7da07c15bcdcf23256b8e2790641a36367d2ebf1`. Do not merge this notes file unless wanted. Do not immediately follow a source push with `railway up`.

```bash
git fetch origin
git checkout master
git merge --ff-only 7da07c15bcdcf23256b8e2790641a36367d2ebf1
test "$(git rev-parse HEAD)" = "7da07c15bcdcf23256b8e2790641a36367d2ebf1"
git push origin master
```

Observe the automatic deployment. Require `SUCCESS`, `commitHash=7da07c15bcdcf23256b8e2790641a36367d2ebf1`, and a **new** `imageDigest`. Logs must show `MCP server:  POST /mcp (23 paid tools)` because production batch is on.

If an upload deployment erases `commitHash` provenance:

```bash
railway redeploy --from-source --yes \
  --project 39cd108e-7036-40cd-97a7-8a86efa1cfd0 \
  --environment 02b78d43-d0f3-48b0-91ed-a2763ef8d2bd \
  --service 1c51e546-ce5f-4d54-9ff9-ef9603674b01
```

Do not use `railway up` for this RC. Do not change Railway variables. Do not recreate the `/data` volume.

## 2. Proposed rollback (operators only; do not run here)

Restore master tree `89f476cfa1790a3692f6a070f96c49f8940f305b`. A non-equal tree is remediation, not a completed rollback.

```bash
git checkout master
# Revert the whole S25 range, not only 7da07c1 (that commit is the mounted test).
git revert --no-commit f9dd59aeeb200881bc1313ed846ba002e7081258..7da07c15bcdcf23256b8e2790641a36367d2ebf1
git commit -S -m "revert: S25 durable rare-funnel (S33 merchant RC)"
test "$(git rev-parse 'HEAD^{tree}')" = "89f476cfa1790a3692f6a070f96c49f8940f305b"
git push origin master
```

Observe the source-derived deploy at the revert commit, then repeat the credential-free checks below. Volume `/data` stays mounted; rare-funnel rows captured under RC are retained private evidence and must not be copied off-volume or published.

## 3. Credential-free acceptance (after a real operator deploy)

No tool call, no payment, no `mcp-publisher publish` until these pass.

```bash
curl -sS https://agents.samedaydesk.com/healthz
# ok=true, network=eip155:8453

curl -sS 'https://agents.samedaydesk.com/v0/commerce-demand.json?days=90' \
  | jq -e '.durableRareFunnel.schemaVersion=="samedaydesk.commerce-rare-funnel-evidence.v1"
         and .paymentEvidence
         and (.durableRareFunnel|tostring|test("0x[0-9a-fA-F]{40}")|not)'

node tools/ops/verify-samedaydesk-mcp.mjs \
  --expected-version 1.23.45 \
  --expected-count 23 \
  --output-schema-tool extract \
  --output-schema-tool extract_batch \
  --output-schema-tool scan \
  --output-schema-tool morpho_protection \
  --output-schema-tool morpho_preliquidation_replay \
  --output-schema-tool opportunity_preflight \
  --output-schema-tool payment_offer_preflight \
  --output-schema-tool contract_qualified_search \
  --output-schema-tool agent_surface_budget_audit \
  --output-schema-tool settlement_proof \
  --output-schema-tool wallet_policy_conformance \
  --output-schema-tool stateful_wallet_policy_conformance
```

Require verifier `toolsCalled=false`, `paymentSigned=false`, `paymentSent=false`. Rollback on any failed gate.

## Out of scope

- Main merge, public post, deploy, live payment, overage, reset from this job
- Private paid-success evidence rewrite; raw public buyer fields
- MCP Registry publish; service-deployment JWS rotation
- Version bump (still `1.23.45`); accept by Railway `commitHash` + `durableRareFunnel`
