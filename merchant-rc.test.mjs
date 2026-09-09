import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const text = readFileSync(new URL("./MERCHANT-RC.md", import.meta.url), "utf8");

const PRODUCT_SHA = "7da07c15bcdcf23256b8e2790641a36367d2ebf1";
const MASTER_SHA = "f9dd59aeeb200881bc1313ed846ba002e7081258";
const MASTER_TREE = "89f476cfa1790a3692f6a070f96c49f8940f305b";
const PRODUCT_TREE = "b4b8e8cd315b1b92564f0665837429cff2923f2c";
const PROJECT = "39cd108e-7036-40cd-97a7-8a86efa1cfd0";
const ENVIRONMENT = "02b78d43-d0f3-48b0-91ed-a2763ef8d2bd";
const SERVICE = "1c51e546-ce5f-4d54-9ff9-ef9603674b01";
const VOLUME = "e4fdd92e-66fc-4937-858a-a1fff9b7d31e";

test("MERCHANT-RC.md is proposed-only and names exact product pins", () => {
  assert.match(text, /execute:false/);
  assert.match(text, /Do not run/);
  assert.match(text, /Feature branch only/);
  assert.equal(text.includes(PRODUCT_SHA), true);
  assert.equal(text.includes(PRODUCT_TREE), true);
  assert.equal(text.includes(MASTER_SHA), true);
  assert.equal(text.includes(MASTER_TREE), true);
  assert.match(text, /eip155:8453/);
  assert.match(text, /1\.23\.45/);
  assert.match(text, /durableRareFunnel/);
  assert.match(text, /samedaydesk\.commerce-rare-funnel-evidence\.v1/);
  assert.doesNotMatch(text, /this job deployed/i);
  assert.doesNotMatch(text, /deployed to production/i);
});

test("MERCHANT-RC.md names immutable Railway production IDs", () => {
  assert.equal(text.includes(PROJECT), true);
  assert.equal(text.includes(ENVIRONMENT), true);
  assert.equal(text.includes(SERVICE), true);
  assert.equal(text.includes(VOLUME), true);
  assert.match(text, /railway status --json/);
  assert.match(text, /select\(\.serviceId=="1c51e546-ce5f-4d54-9ff9-ef9603674b01"\)/);
});

test("MERCHANT-RC.md contains exact proposed source-derived deploy commands", () => {
  assert.match(text, /git merge --ff-only 7da07c15bcdcf23256b8e2790641a36367d2ebf1/);
  assert.match(text, /git push origin master/);
  assert.match(text, /Do not immediately follow a source push with `railway up`/);
  assert.match(text, /railway redeploy --from-source --yes/);
  assert.match(text, /--project 39cd108e-7036-40cd-97a7-8a86efa1cfd0/);
  assert.match(text, /--environment 02b78d43-d0f3-48b0-91ed-a2763ef8d2bd/);
  assert.match(text, /--service 1c51e546-ce5f-4d54-9ff9-ef9603674b01/);
  assert.match(text, /MCP server:  POST \/mcp \(23 paid tools\)/);
  assert.doesNotMatch(text, /^railway up /m);
});

test("MERCHANT-RC.md rollback restores the full S25 range and master tree", () => {
  assert.match(
    text,
    /git revert --no-commit f9dd59aeeb200881bc1313ed846ba002e7081258\.\.7da07c15bcdcf23256b8e2790641a36367d2ebf1/,
  );
  assert.match(text, /git rev-parse 'HEAD\^\{\s*tree\s*\}'/);
  assert.equal(text.includes(`= "${MASTER_TREE}"`), true);
  assert.match(text, /not only 7da07c1/);
});

test("MERCHANT-RC.md post-deploy verifier is credential-free and count-23", () => {
  assert.match(text, /verify-samedaydesk-mcp\.mjs/);
  assert.match(text, /--expected-version 1\.23\.45/);
  assert.match(text, /--expected-count 23/);
  for (const tool of [
    "extract",
    "extract_batch",
    "scan",
    "morpho_protection",
    "morpho_preliquidation_replay",
    "opportunity_preflight",
    "payment_offer_preflight",
    "contract_qualified_search",
    "agent_surface_budget_audit",
    "settlement_proof",
    "wallet_policy_conformance",
    "stateful_wallet_policy_conformance",
  ]) {
    assert.equal(text.includes(`--output-schema-tool ${tool}`), true, tool);
  }
  assert.match(text, /toolsCalled=false/);
  assert.match(text, /paymentSigned=false/);
  assert.match(text, /paymentSent=false/);
  assert.match(text, /mcp-publisher publish/);
});
