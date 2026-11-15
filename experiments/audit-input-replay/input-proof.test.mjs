import assert from "node:assert/strict";
import test from "node:test";
import { matchesAuditInputs, replayAuditInputs } from "./input-proof.mjs";

const origin = "https://seller.example";
const route = "/read";
const input = { origin, route };
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const payTo = "0x1111111111111111111111111111111111111111";
const operation = {
  "x-payment-info": { price: { amount: "0.01", currency: "USD" }, protocols: [{ x402: { asset, network: "eip155:8453", scheme: "exact" } }] },
  responses: { 200: { content: { "application/json": { schema: {
    type: "object", required: ["ok"], properties: { ok: { type: "boolean" } },
  } } } } },
};

function fixture({ amount = "10000", operationOverride = operation, status = 402, notes = {} } = {}) {
  const doc = { openapi: "3.1.0", info: { title: "fixture", version: "1.0.0" }, paths: { [route]: { get: operationOverride } } };
  const document = Buffer.from(JSON.stringify(doc));
  const quote = Buffer.from(JSON.stringify({
    x402Version: 2,
    resource: { url: `${origin}${route}`, description: "fixture", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", asset, payTo, amount, maxTimeoutSeconds: 300 }],
  })).toString("base64");
  const called = [];
  const requestImpl = async (url) => {
    called.push(url.href);
    if (url.pathname === "/openapi.json") return { status: 200, body: document, headers: {} };
    if (url.pathname === "/mpp-openapi.json") return { status: 404, body: Buffer.alloc(0), headers: {} };
    if (url.pathname === route) return { status, body: Buffer.alloc(0), headers: {
      "payment-required": quote, "x-fixture-opaque": "never-export-this", ...notes,
    } };
    throw new Error("unknown replay input");
  };
  return { document, quote, called, requestImpl };
}

test("the installed audit accepts the wire fixture and a cold buyer matches exact saved inputs", async () => {
  const saved = fixture();
  const { result, proof } = await replayAuditInputs(input, saved.requestImpl);
  assert.equal(result.decision, "machine_buyable");
  assert.equal(result.report.economics.x402.amountAtomic, "10000");
  assert.deepEqual(saved.called, ["/openapi.json", "/mpp-openapi.json", route].map((path) => origin + path));
  assert.equal(matchesAuditInputs(JSON.parse(JSON.stringify(proof)), proof.digest, saved), true);
  assert.doesNotMatch(JSON.stringify(proof), new RegExp(`never-export-this|${payTo}|${saved.quote}`));
});

test("the existing schema evidence stays identical when only the quote changes", async () => {
  const saved = fixture();
  const changed = fixture({ amount: "20000" });
  const before = await replayAuditInputs(input, saved.requestImpl);
  const after = await replayAuditInputs(input, changed.requestImpl);
  assert.equal(after.result.report.economics.x402.amountAtomic, "20000");
  assert.match(before.result.report.responseContract.schemaDigest, /^[0-9a-f]{64}$/);
  assert.equal(before.result.report.responseContract.schemaDigest, after.result.report.responseContract.schemaDigest);
  assert.equal(before.proof.documentSha256, after.proof.documentSha256);
  assert.equal(matchesAuditInputs(before.proof, before.proof.digest, changed), false);
  assert.equal(matchesAuditInputs(after.proof, before.proof.digest, changed), false);
});

test("a byte rewrite, swapped route or missing trusted digest cannot match", async () => {
  const saved = fixture();
  const { proof } = await replayAuditInputs(input, saved.requestImpl);
  const reserialized = Buffer.from(JSON.stringify(JSON.parse(saved.document), null, 2));
  assert.equal(matchesAuditInputs(proof, proof.digest, { ...saved, document: reserialized }), false);
  assert.equal(matchesAuditInputs({ ...proof, route: "/another" }, proof.digest, saved), false);
  assert.equal(matchesAuditInputs(proof, undefined, saved), false);
  assert.equal(matchesAuditInputs(proof, proof.digest, null), false);
});

test("uncovered and unavailable evidence never receives a complete x402 input match", async () => {
  const refused = fixture({ status: 200 });
  const alternate = fixture({ notes: { "www-authenticate": "Payment synthetic" } });
  const normal = fixture();
  assert.equal((await replayAuditInputs(input, refused.requestImpl)).proof, null);
  assert.equal((await replayAuditInputs(input, alternate.requestImpl)).proof, null);
  assert.equal((await replayAuditInputs({ ...input, requiredPaths: ["ok"] }, normal.requestImpl)).proof, null);
  await assert.rejects(replayAuditInputs(input), /replay transport/);
});
