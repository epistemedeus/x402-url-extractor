import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { sellerIntegrityAudit, sellerIntegrityAuditOutputSchema } from "./seller-integrity-audit.mjs";

const origin = "https://seller.example";
const route = "/read";
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const payTo = "0x1111111111111111111111111111111111111111";
const op = {
  "x-payment-info": { price: { amount: "0.01", currency: "USD" }, protocols: [{ x402: { asset, network: "eip155:8453", scheme: "exact" } }] },
  responses: { 200: { content: { "application/json": { schema: {
    type: "object", required: ["ok"], properties: { ok: { type: "boolean" } },
  } } } } },
};
const document = Buffer.from(JSON.stringify({ openapi: "3.1.0", info: { title: "fixture", version: "1.0.0" },
  paths: { [route]: { get: op, post: op } } }));

function fixture({ amount = "10000", fail = false, extra = {} } = {}) {
  const calls = [];
  const quote = Buffer.from(JSON.stringify({ x402Version: 2,
    resource: { url: `${origin}${route}`, description: "fixture", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", asset, payTo, amount, maxTimeoutSeconds: 300 }],
  })).toString("base64");
  return { calls, quote, requestImpl: async (url, options) => {
    const endpoint = new URL(url);
    assert.equal(endpoint.origin, origin);
    assert.equal(options.publicDns, true);
    calls.push(endpoint.pathname);
    if (endpoint.pathname === "/openapi.json") return { status: 200, headers: {}, body: document };
    if (endpoint.pathname === "/mpp-openapi.json") return { status: 404, headers: {}, body: Buffer.alloc(0) };
    if (fail) throw new Error("transport failed before HTTP");
    return { status: 402, body: Buffer.alloc(0), headers: {
      "payment-required": quote, "www-authenticate": "Bearer opaque-fixture-token", ...extra,
    } };
  } };
}

test("the actual audit captures the selected wire evidence once and remains compatible with the former result schema", async () => {
  const source = fixture();
  const result = await sellerIntegrityAudit({ origin, route }, { requestImpl: source.requestImpl });
  const evidence = result.report.probe?.inputEvidence;
  assert.equal(result.decision, "machine_buyable");
  assert.deepEqual(source.calls, ["/openapi.json", "/mpp-openapi.json", route]);
  assert.equal(evidence.scope, "public_probe");
  assert.deepEqual(evidence.observations.map(x => [x.kind, x.status]), [["openapi", 200], ["mpp_openapi", 404], ["probe", 402]]);
  assert.match(evidence.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence.observations[2].mppChallengeDigest, null);
  assert.doesNotMatch(JSON.stringify(evidence), /seller\.example|opaque-fixture-token|0x1111/);
  assert.equal(JSON.stringify(evidence).includes(source.quote), false);
  const ajv = addFormats(new Ajv2020({ strict: false }));
  const current = sellerIntegrityAuditOutputSchema();
  const before = structuredClone(current);
  delete before.properties.report.properties.probe.properties;
  assert.equal(ajv.validate(current, result), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(before, result), true, JSON.stringify(ajv.errors));
});

test("identical inputs stay comparable, while a quote-only change does not masquerade as a schema change", async () => {
  const run = async (opts) => sellerIntegrityAudit({ origin, route }, { requestImpl: fixture(opts).requestImpl });
  const previous = await run();
  const same = await run();
  const changed = await run({ amount: "20000" });
  assert.equal(previous.report.probe.inputEvidence.digest, same.report.probe.inputEvidence.digest);
  assert.equal(previous.report.responseContract.schemaDigest, changed.report.responseContract.schemaDigest);
  assert.notEqual(previous.report.probe.inputEvidence.digest, changed.report.probe.inputEvidence.digest);
  assert.notEqual(previous.report.probe.inputEvidence.observations[2].x402ChallengeDigest,
    changed.report.probe.inputEvidence.observations[2].x402ChallengeDigest);
});

test("POST produces declaration evidence only without sending a request to the seller action", async () => {
  const source = fixture();
  const result = await sellerIntegrityAudit({ origin, route, method: "POST" }, { requestImpl: source.requestImpl });
  assert.deepEqual(source.calls, ["/openapi.json", "/mpp-openapi.json"]);
  assert.equal(result.decision, "contract_ready");
  assert.equal(result.report.probe.inputEvidence.scope, "public_declarations");
  assert.equal(result.report.probe.inputEvidence.observations.length, 2);
  assert.equal(result.boundary.targetRequestSent, false);
});

test("failed capture cannot invent evidence or change the audit refusal", async () => {
  const network = await sellerIntegrityAudit({ origin, route }, { requestImpl: fixture({ fail: true }).requestImpl });
  assert.equal(network.decision, "repair_required");
  assert.equal(network.report.probe.inputEvidence, undefined);
  const oversized = await sellerIntegrityAudit({ origin, route }, {
    requestImpl: fixture({ extra: { link: " ".repeat(65_537) } }).requestImpl,
  });
  assert.equal(oversized.decision, "machine_buyable");
  assert.equal(oversized.report.probe.inputEvidence, undefined);
});
