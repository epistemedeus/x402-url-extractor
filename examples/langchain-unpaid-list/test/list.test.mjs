import assert from "node:assert/strict";
import test from "node:test";
import { listUnpaidResources } from "../src/list.mjs";
import { DEFAULT_CATALOG_PATH } from "../src/paths.mjs";
import { UnpaidListError } from "../src/errors.mjs";

test("default fixture lists extract, batch, and read without paying", async () => {
  const report = await listUnpaidResources();
  assert.equal(report.ok, true);
  assert.equal(report.source.kind, "fixture");
  assert.equal(report.source.path, DEFAULT_CATALOG_PATH);
  assert.equal(report.itemCount, 3);
  assert.deepEqual(report.items.map((item) => item.route), ["/extract", "/extract/batch", "/read"]);
  assert.equal(report.items[0].method, "GET");
  assert.equal(report.items[1].method, "POST");
  assert.equal(report.items[0].accepts[0].amountAtomic, "5000");
  assert.equal(report.items[1].accepts[0].amountAtomic, "10000");
  assert.equal(report.boundary.paymentSent, false);
  assert.equal(report.boundary.walletAccessed, false);
  assert.equal(report.boundary.paidBodyRead, false);
  assert.equal(report.boundary.liveChallengeFetched, false);
});

test("query and route filters narrow the unpaid list", async () => {
  const queried = await listUnpaidResources({ query: "batch" });
  assert.deepEqual(queried.items.map((item) => item.route), ["/extract/batch"]);
  const routed = await listUnpaidResources({ route: "/extract" });
  assert.equal(routed.itemCount, 1);
  assert.equal(routed.items[0].route, "/extract");
  assert.equal(routed.catalogCount, 3);
});

test("payment options are refused before catalog read", async () => {
  await assert.rejects(() => listUnpaidResources({ approve: true }), (error) => {
    assert.equal(error instanceof UnpaidListError, true);
    assert.equal(error.code, "payment_intent_refused");
    return true;
  });
});
