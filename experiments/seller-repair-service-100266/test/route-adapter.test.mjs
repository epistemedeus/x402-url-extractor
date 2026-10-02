import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import express from "express";

import { mountSellerRepairDiagnosis } from "../route/mount.mjs";

const PRIVATE = "PRIVATE_SENTINEL_do_not_keep";
const cases = join(import.meta.dirname, "..", "cases");
const quota = JSON.parse(readFileSync(join(cases, "supplied-quota.json"), "utf8"));
const health = JSON.parse(readFileSync(join(cases, "supplied-health.json"), "utf8"));
const incomplete = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "local-audit-incomplete.json"), "utf8"));

function listen(app) {
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function post(server, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/commerce/seller-repair-diagnosis`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

test("the diagnosis route does not charge and keeps settlement apart from useful output", async () => {
  let lookups = 0;
  let mode = "private";
  const app = express();
  app.disable("x-powered-by");
  const mounted = mountSellerRepairDiagnosis(app, {
    lookupImpl: async () => {
      lookups += 1;
      if (mode === "flip") return [{ address: lookups % 2 ? "93.184.216.34" : "1.1.1.1", family: 4 }];
      return [{ address: "10.1.2.3", family: 4 }];
    },
  });
  assert.equal(mounted.charged, false);
  assert.equal(mounted.priceChanged, false);
  assert.equal(mounted.skuAdded, false);
  assert.equal(mounted.route, "/commerce/seller-repair-diagnosis");
  const server = await listen(app);
  try {
    const denied = await fetch(`http://127.0.0.1:${server.address().port}/commerce/seller-repair-diagnosis`);
    const deniedBody = await denied.json();
    assert.equal(denied.status, 405);
    assert.notEqual(denied.status, 402);
    assert.equal(deniedBody.charged, false);
    assert.equal(deniedBody.paymentSent, false);

    const ready = await post(server, { ...health, probe: false, requestId: "health-1" });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.charged, false);
    assert.equal(ready.body.paymentSent, false);
    assert.equal(ready.body.priceChanged, false);
    assert.equal(ready.body.skuAdded, false);
    assert.equal(ready.body.usefulOutput.matched, true);
    assert.equal(ready.body.usefulOutput.outcome, "free_sufficient");
    assert.equal(ready.body.usefulOutput.http200IsSuccess, false);
    assert.equal(ready.body.paid.connected, false);
    assert.equal(ready.body.paid.purchasePerformed, false);
    assert.equal(ready.body.paid.priceAtomic, "10000");
    assert.equal(ready.body.paid.route, "/commerce/seller-integrity-audit");
    assert.equal(ready.body.challenge, null);
    assert.equal(ready.body.delivery.valid, false);
    assert.equal(ready.body.callerId, "health-caller");
    assert.equal(ready.body.operationId, "GET /v1/health");
    assert.equal(ready.body.declaredSdk, "python-httpx@1");
    assert.equal(ready.body.tokens, "unknown");
    assert.equal(ready.body.adaptationMaintenanceCost, "unknown");
    assert.equal(ready.body.recognizedRevenueAtomic, "0");
    assert.equal(lookups, 0);

    const again = await post(server, { ...health, probe: false, requestId: "health-1" });
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.probesRepeated, 0);
    assert.equal(again.body.usefulOutput.matched, true);
    assert.equal(lookups, 0);

    const conflict = await post(server, { ...health, probe: false, requestId: "health-1", expect: { path: "status", value: "down" } });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.charged, false);
    assert.equal(conflict.body.reason, "duplicate_conflict");

    const beforePrivate = lookups;
    const hidden = await post(server, { ...quota, requestId: "private-1" });
    assert.equal(hidden.body.usefulOutput.matched, false);
    assert.equal(hidden.body.usefulOutput.reason, "target_not_public");
    assert.equal(hidden.body.charged, false);
    assert.ok(lookups > beforePrivate);
    const afterPrivate = lookups;
    const repeated = await post(server, { ...quota, requestId: "private-1" });
    assert.equal(repeated.body.duplicate, true);
    assert.equal(repeated.body.probesRepeated, 0);
    assert.equal(lookups, afterPrivate);

    mode = "flip";
    const moved = await post(server, { ...health, probe: true, requestId: "dns-1" });
    assert.equal(moved.body.usefulOutput.reason, "dns_changed");
    assert.equal(moved.body.charged, false);
    assert.equal(moved.body.usefulOutput.matched, false);

    const transport = await post(server, { transport: "websocket" });
    assert.equal(transport.status, 200);
    assert.equal(transport.body.usefulOutput.reason, "unsupported_transport");
    assert.equal(transport.body.charged, false);
    assert.equal(transport.body.paymentSent, false);

    const malformed = await post(server, { callerId: "health-caller" });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.charged, false);
    assert.equal(malformed.body.usefulOutput.http200IsSuccess, false);

    const numeric = await post(server, { ...health, probe: false, expect: { path: "status", value: 3 } });
    assert.equal(numeric.status, 400);
    assert.equal(numeric.body.charged, false);

    const signed = await post(server, { ...health, probe: false, paymentSignature: "sig" });
    assert.equal(signed.status, 400);
    assert.equal(signed.body.charged, false);
    assert.equal(signed.text.includes("sig"), false);

    const sentinel = await post(server, {
      ...health,
      probe: false,
      observed: { status: 200, json: { status: PRIVATE }, contentType: "application/json" },
    });
    assert.equal(sentinel.body.usefulOutput.reason, "private_body_withheld");
    assert.equal(sentinel.text.includes(PRIVATE), false);

    const unpaid = await post(server, {
      ...health,
      probe: false,
      paidReport: {
        ...incomplete,
        request: { origin: "https://status.example", route: "/v1/health", method: "GET" },
      },
      settlement: { kind: "failure" },
    });
    assert.equal(unpaid.body.paid.gap, "audit_incomplete_retained");
    assert.equal(unpaid.body.paid.connected, false);
    assert.equal(unpaid.body.settlement.preserved, "failure");
    assert.equal(unpaid.body.settlement.actualValidDelivery, false);
    assert.equal(unpaid.body.delivery.valid, false);
    assert.equal(unpaid.body.usefulOutput.matched, true);

    for (const kind of ["unknown", "replay", "valid_delivery"]) {
      const settled = await post(server, { ...health, probe: false, settlement: { kind } });
      assert.equal(settled.body.delivery.valid, false, kind);
      assert.equal(settled.body.settlement.paymentSentByPackage, false, kind);
      assert.equal(settled.body.usefulOutput.matched, true, kind);
      assert.notEqual(settled.body.settlement.preserved, "unspecified", kind);
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
