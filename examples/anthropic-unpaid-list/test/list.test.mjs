import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createRecordedFetch, loadRecordedDiscovery } from "../src/fixtures.mjs";
import { listUnpaid } from "../src/list.mjs";
import { ListError } from "../src/errors.mjs";
import { MISSING_EXTRACT, PAID_DELIVERY, RECORDED, ROOT } from "./helpers.mjs";

const REPO_ROOT = join(ROOT, "../..");

test("recorded unpaid discovery lists extract inventory without paying", async () => {
  const recorded = loadRecordedDiscovery(RECORDED);
  const report = await listUnpaid({
    origin: "https://agents.samedaydesk.com",
    fetchImpl: createRecordedFetch(recorded),
    repoRoot: REPO_ROOT,
  });
  assert.equal(report.ok, true);
  assert.equal(report.product, "samedaydesk-anthropic-unpaid-list");
  assert.equal(report.runtime, "anthropic-claude-code");
  assert.equal(report.paymentAttempted, false);
  assert.equal(report.walletAccessed, false);
  assert.equal(report.checkoutAttempted, false);
  assert.equal(report.published, false);
  assert.equal(report.neoTouched, false);
  assert.deepEqual(report.extractInventory.mcp, ["extract", "extract_batch"]);
  assert.deepEqual(report.extractInventory.http, ["/extract", "/extract/batch"]);
  assert.equal(report.marketplace.officialAnthropicDirectory, false);
  assert.equal(report.marketplace.paymentGrantedByListing, false);
  const getExtract = report.surfaces.find((surface) => surface.path === "/extract" && surface.kind === "unpaid_challenge");
  const batch = report.surfaces.find((surface) => surface.path === "/extract/batch" && surface.kind === "unpaid_challenge");
  assert.equal(getExtract.status, 402);
  assert.equal(getExtract.offer.amount, "5000");
  assert.equal(batch.status, 402);
  assert.equal(batch.offer.amount, "10000");
  assert.equal(report.surfaces.find((surface) => surface.method === "tools/list").toolsCalled, false);
  assert.equal(ROOT.endsWith("anthropic-unpaid-list"), true);
});

test("HTTP 200 extract delivery is refused rather than treated as unpaid success", async () => {
  const recorded = loadRecordedDiscovery(PAID_DELIVERY);
  await assert.rejects(
    () => listUnpaid({
      origin: "https://agents.samedaydesk.com",
      fetchImpl: createRecordedFetch(recorded),
      repoRoot: REPO_ROOT,
    }),
    (error) => error instanceof ListError && error.code === "unexpected_delivery" && error.exitCode === 1,
  );
});

test("missing extract inventory is not ok", async () => {
  const recorded = loadRecordedDiscovery(MISSING_EXTRACT);
  const report = await listUnpaid({
    origin: "https://agents.samedaydesk.com",
    fetchImpl: createRecordedFetch(recorded),
    repoRoot: REPO_ROOT,
  });
  assert.equal(report.ok, false);
  assert.equal(report.paymentAttempted, false);
  assert.deepEqual(report.extractInventory.mcp, []);
});

test("recorded fetch refuses MCP tools/call", async () => {
  const recorded = loadRecordedDiscovery(RECORDED);
  const fetchImpl = createRecordedFetch(recorded);
  await assert.rejects(
    () => fetchImpl("https://agents.samedaydesk.com/mcp", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "extract" } }),
    }),
    (error) => error instanceof ListError && error.code === "operation_refused",
  );
});
