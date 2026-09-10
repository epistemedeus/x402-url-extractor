import assert from "node:assert/strict";

export function assertDecision(packet, allowed) {
  const set = new Set(allowed);
  assert.ok(packet && typeof packet === "object", "packet object");
  assert.ok(set.has(packet.decision), `decision ${packet.decision} not in ${[...set]}`);
}

export function assertCitedFindings(packet) {
  const findings = packet.findings || packet.brief?.findings || [];
  for (const f of findings) {
    const cites = f.citationIds || f.citations || f.citationId;
    const list = Array.isArray(cites) ? cites : cites ? [cites] : [];
    assert.ok(list.length > 0, `finding ${f.id || "?"} missing citations`);
  }
}

export function assertNoInventedDemand(packet) {
  const claims = packet.claims || packet.brief?.claims || {};
  assert.equal(claims.assertsCustomerDemand ?? claims.assertsCustomerDemand ?? false, false);
  assert.equal(claims.paidEndpoint ?? claims.paidEndpoint ?? false, false);
}
