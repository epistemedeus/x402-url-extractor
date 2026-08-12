import assert from "node:assert/strict";
import test from "node:test";

import { decorateMcpTool, listMcpToolMetadata } from "./mcp-tool-metadata.mjs";

test("publishes unique action-oriented titles for every live MCP tool", () => {
  const metadata = listMcpToolMetadata();
  assert.equal(metadata.length, 20);
  assert.equal(new Set(metadata.map((entry) => entry.name)).size, 20);
  assert.equal(new Set(metadata.map((entry) => entry.title)).size, 20);
  for (const entry of metadata) {
    assert.match(entry.title, /^(?:Extract|Read|Scan|Generate|Enrich|Audit|Inspect|Plan|Underwrite|Replay|Preflight|Verify|Evaluate)\b/);
  }
});

test("makes each overlapping web and company tool chooseable without renaming it", () => {
  const decorate = (name) => decorateMcpTool({ name, description: `${name} base contract` });
  const extract = decorate("extract");
  const read = decorate("read");
  const schemaforge = decorate("schemaforge");
  const enrich = decorate("enrich");
  const deepAudit = decorate("deep_audit");
  const wallet = decorate("wallet_enrich");
  const morphoPosition = decorate("morpho_position");
  const morphoProtection = decorate("morpho_protection");
  const morphoUnderwrite = decorate("morpho_market_underwrite");
  const morphoReplay = decorate("morpho_preliquidation_replay");
  const settlementProof = decorate("settlement_proof");
  const sellerIntegrity = decorate("seller_integrity_audit");
  const transactionReceipt = decorate("transaction_receipt");
  const solanaTransactionReceipt = decorate("solana_transaction_receipt");

  assert.equal(extract.name, "extract");
  assert.match(extract.description, /Use `read` instead/);
  assert.match(read.description, /Use `extract` instead/);
  assert.match(schemaforge.description, /Use `deep_audit` instead/);
  assert.match(schemaforge.description, /does not guarantee AI citations/);
  assert.match(enrich.description, /Use `schemaforge` instead/);
  assert.match(deepAudit.description, /evidence from `enrich`/);
  assert.match(deepAudit.description, /template from `schemaforge`/);
  assert.match(wallet.description, /Use `enrich` for a company domain/);
  assert.match(morphoPosition.description, /Use `morpho_protection`/);
  assert.match(morphoProtection.description, /Use `morpho_position`/);
  assert.match(morphoUnderwrite.description, /Use `morpho_position` or `morpho_protection`/);
  assert.match(morphoReplay.description, /Use `morpho_market_underwrite`/);
  assert.match(morphoProtection.description, /unsigned ERC-20 approval plus Morpho call templates/);
  assert.match(settlementProof.description, /Use `payment_offer_preflight` before authorization/);
  assert.match(sellerIntegrity.description, /Use `payment_offer_preflight` instead/);
  assert.match(sellerIntegrity.description, /`agent_discoverability_audit` for catalog rank/);
  assert.match(sellerIntegrity.description, /GET or POST seller route/);
  assert.match(sellerIntegrity.description, /POST performs static-safe OpenAPI contract analysis and sends no target request/);
  assert.match(transactionReceipt.description, /Use `settlement_proof` instead/);
  assert.match(solanaTransactionReceipt.description, /use `transaction_receipt` for Base or Ethereum/);
});

test("fails closed when a live tool lacks explicit selection metadata", () => {
  assert.throws(() => decorateMcpTool({ name: "new_tool", description: "new" }), /Missing MCP selection metadata/);
  assert.throws(() => decorateMcpTool({ name: "extract", description: "" }), /Missing MCP description/);
});
