import assert from "node:assert/strict";
import { requestPinned } from "agent-payment-integrity";
import { matchesAuditInputs, replayAuditInputs } from "./input-proof.mjs";

const origin = "https://agents.samedaydesk.com";
const route = "/commerce/payment-offer-preflight";
const evidencePath = "/.well-known/agent-payment-evidence.json";
const held = {};
const observations = [];
const started = performance.now();
const { result, proof } = await replayAuditInputs({ origin, route }, async (url, options) => {
  assert.equal(url.origin, origin);
  assert.ok(["/openapi.json", "/mpp-openapi.json", route, evidencePath].includes(url.pathname));
  assert.ok(observations.length < 4, "bounded to four unsigned GETs");
  const response = await requestPinned(url, options);
  observations.push({ path: url.pathname, status: response.status });
  if (url.pathname === "/openapi.json") held.document = response.body;
  if (url.pathname === "/mpp-openapi.json") held.mpp = { status: response.status, document: response.body };
  if (url.pathname === evidencePath) held.purchaseEvidence = response.body;
  if (url.pathname === route) {
    held.href = url.href;
    held.quote = response.headers["payment-required"];
    held.link = response.headers.link;
    assert.ok(url.searchParams.has("url"));
  }
  return response;
});
const liveMs = Math.round(performance.now() - started);
assert.deepEqual(observations, [
  { path: "/openapi.json", status: 200 }, { path: "/mpp-openapi.json", status: 200 }, { path: route, status: 402 },
  { path: evidencePath, status: 200 },
]);
const findings = result.report.findings.map((f) => /^[a-z0-9_-]+$/.test(f) ? f : f.split(":")[0]);
console.log(JSON.stringify({ decision: result.decision, contract: result.report.responseContract?.decision,
  observations, findings, protocols: result.report.protocols, proofPresent: !!proof }));
assert.ok(["machine_buyable", "repair_required"].includes(result.decision));
assert.equal(result.report.runtimeChallengeVerified, true);
assert.equal(result.report.economics.x402.amountAtomic, "5000");
assert.ok(proof, "the actual serving evidence profile must be supported");
const verifyAt = performance.now();
assert.equal(matchesAuditInputs(proof, proof.digest, held), true);
assert.equal(matchesAuditInputs(proof, proof.digest, { ...held, quote: `${held.quote}A` }), false);
assert.equal(matchesAuditInputs(proof, proof.digest, { ...held, href: `${held.href}&changed=1` }), false);
assert.equal(matchesAuditInputs(proof, proof.digest, { ...held, purchaseEvidence: null }), false);
console.log(JSON.stringify({ observations, liveMs, localChecksMs: Number((performance.now() - verifyAt).toFixed(3)),
  decision: result.decision, amountAtomic: result.report.economics.x402.amountAtomic, proofFields: Object.keys(proof),
  paymentSent: false, claims: "input continuity only; not independent attestation or historical availability" }));
