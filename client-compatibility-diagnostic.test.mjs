import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIFACT,
  EXECUTOR,
  HOSTINGER_SUPPORT_STATEMENT,
  LATER_TASK_ID,
  buildReceipt,
  checkDecisionReceipt,
  classifyClientCompatibility,
  replayNodeHttps,
  resetReplaySlotsForTests,
} from "./client-compatibility-diagnostic.mjs";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const TASK = "Later task: after an official Hermes client change or a Root-owned edge change, decide whether the official Hermes well-known installer can fetch the public skill index, using a successful Node HTTPS control on the same method and route. A header profile is not native execution. A generic 403 is not a confirmed CDN policy.";

function binding(overrides = {}) {
  return {
    clientId: "hermes-agent",
    clientVersion: "0.19.0",
    method: "GET",
    origin: "https://neomorphic.io",
    route: "/.well-known/skills/index.json",
    ...overrides,
  };
}

function base(overrides = {}) {
  return {
    taskText: TASK,
    binding: binding(),
    execution: "independent_replay",
    executor: EXECUTOR,
    runtime: { node: "v22.14.0" },
    ...overrides,
  };
}

function hermes(overrides = {}) {
  return {
    clientId: "hermes-agent",
    version: "0.19.0",
    nativeExecution: true,
    headerProfileInjected: false,
    method: "GET",
    route: "/.well-known/skills/index.json",
    status: 403,
    observedAt: "2026-10-01T11:59:30.000Z",
    headersCaptured: true,
    headers: {
      "x-hcdn-request-id": "22a0f6019fef2334c74bcde29b849650-imm-edge6",
      date: "Thu, 01 Oct 2026 11:59:30 GMT",
      server: "hcdn",
      "content-type": "text/html",
      authorization: "must-not-leak",
    },
    installed: false,
    exitCode: 0,
    ...overrides,
  };
}

function nodeControl(overrides = {}) {
  return {
    clientId: "node-https",
    version: "v22.14.0",
    nativeExecution: true,
    method: "GET",
    route: "/.well-known/skills/index.json",
    status: 200,
    observedAt: "2026-10-01T11:59:40.000Z",
    headersCaptured: true,
    headers: {
      "x-hcdn-request-id": "addebbb5f9af4b1854dcb7a80f23651b-imm-edge5",
      "content-type": "application/json; charset=UTF-8",
      server: "hcdn",
    },
    ...overrides,
  };
}

test("official Hermes refusal against a Node 200 is client or edge refusal, not a CDN policy or a paid audit", () => {
  const result = classifyClientCompatibility(base({
    official: hermes(),
    control: nodeControl(),
    cdnPolicyConfirmed: true,
    enginesNodePin: ">=22.20.0",
    pinSource: "supplied",
  }), { now: NOW });
  assert.equal(result.artifact, ARTIFACT);
  assert.equal(result.laterTask, LATER_TASK_ID);
  assert.equal(result.class, "client_or_edge_refusal");
  assert.equal(result.nativeExecution, true);
  assert.equal(result.nativeCompatible, false);
  assert.equal(result.falseSuccessCli, true);
  assert.equal(result.cdnPolicyConfirmed, false);
  assert.equal(result.callerCdnPolicyClaim, "rejected");
  assert.equal(result.cdnDelivery, "hostinger_header_present");
  assert.equal(result.requestId, "22a0f6019fef2334c74bcde29b849650-imm-edge6");
  assert.equal(result.requestIdSource, "x-hcdn-request-id");
  assert.equal(result.evidenceKind, "independent_replay");
  assert.equal(result.paidOperation.paidAuditRequired, false);
  assert.equal(result.paidOperation.executed, false);
  assert.equal(result.paidOperation.reason, "paid_service_cannot_execute_client_profile");
  assert.equal(result.paidOperation.path, "/commerce/seller-integrity-audit");
  assert.equal(result.readiness.establishesClientCompatibility, false);
  assert.equal(result.enginePinSatisfied, null);
  assert.equal(result.pinVerified, false);
  assert.equal(result.suppliedEnginesNodePin, ">=22.20.0");
  assert.equal(result.runtime.node, "v22.14.0");
  assert.equal(result.providerReceivingAction.id, "hostinger_support_packet");
  assert.equal(result.providerReceivingAction.sent, false);
  assert.equal(result.providerReceivingAction.dashboardAllowlist, false);
  assert.equal(result.providerReceivingAction.statement, HOSTINGER_SUPPORT_STATEMENT);
  assert.equal(result.nextAction.id, "use_node_https_public_installer");
  assert.equal(result.nextAction.executed, false);
  assert.equal(result.nextAction.callerAuthorized, false);
  assert.equal(result.evidenceBoundary.bodyRetained, false);
  assert.equal(result.evidenceBoundary.independentDemandConfirmed, false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/);
});

test("caller authorization records the offered action and does not send the provider packet", () => {
  const result = classifyClientCompatibility(base({
    official: hermes(),
    control: nodeControl(),
    authorizeNextAction: true,
    authorizedActionId: "use_node_https_public_installer",
  }), { now: NOW });
  assert.equal(result.nextAction.callerAuthorized, true);
  assert.equal(result.nextAction.executed, false);
  assert.equal(result.providerReceivingAction.sent, false);
});

test("a 403 without x-hcdn-request-id does not become a Hostinger support packet", () => {
  const result = classifyClientCompatibility(base({
    official: hermes({ headers: { server: "hcdn", date: "Thu, 01 Oct 2026 11:59:30 GMT" }, headersCaptured: true }),
    control: nodeControl(),
  }), { now: NOW });
  assert.equal(result.class, "client_or_edge_refusal");
  assert.equal(result.cdnDelivery, "hostinger_header_absent");
  assert.equal(result.cdnPolicyConfirmed, false);
  assert.equal(result.providerReceivingAction, null);
  assert.match(result.nextAction.statement, /not a confirmed CDN policy/);
});

test("a lone 403 stays inconclusive", () => {
  const result = classifyClientCompatibility(base({ official: hermes() }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "control_required");
  assert.equal(result.providerReceivingAction, null);
  assert.equal(result.nativeCompatible, false);
});

test("the same refusal on the control is not client-specific", () => {
  const result = classifyClientCompatibility(base({
    official: hermes(),
    control: nodeControl({ status: 403 }),
  }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "same_status_not_client_specific");
});

test("a header profile is not native Hermes success", () => {
  const result = classifyClientCompatibility(base({
    execution: "header-profile",
    official: hermes({ headerProfileInjected: true, status: 200, installed: true, exitCode: 0 }),
    control: nodeControl(),
  }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "header_profile_is_not_native_execution");
  assert.equal(result.nativeExecution, false);
  assert.equal(result.nativeCompatible, false);
  assert.equal(result.evidenceKind, "supplied");
});

test("an unknown runtime abstains", () => {
  const result = classifyClientCompatibility(base({
    binding: binding({ clientId: "goose-custom" }),
  }), { now: NOW });
  assert.equal(result.class, "unknown_runtime");
  assert.equal(result.abstain, true);
  assert.equal(result.nativeCompatible, false);
  assert.equal(result.paidOperation.paidAuditRequired, false);
});

test("supplied evidence stays supplied", () => {
  const result = classifyClientCompatibility(base({
    execution: "supplied",
    executor: "pilot-251",
    official: hermes({ headersCaptured: false, headers: {} }),
    control: nodeControl(),
  }), { now: NOW });
  assert.equal(result.evidenceKind, "supplied");
  assert.equal(result.nativeExecution, false);
  assert.equal(result.class, "client_or_edge_refusal");
  assert.equal(result.cdnDelivery, "not_captured");
  assert.equal(result.sourceClaimsNativeExecution, true);
});

test("a claimed replay from another process is not independent", () => {
  const result = classifyClientCompatibility(base({ executor: "somewhere-else", official: hermes(), control: nodeControl() }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "replay_claim_not_this_process");
  assert.equal(result.nativeExecution, false);
});

test("a method mismatch is free-sufficient and is not a client refusal", () => {
  const result = classifyClientCompatibility(base({
    binding: binding({ route: "/lockfile-pin-delta", origin: "https://agents.samedaydesk.com" }),
    declaredMethod: "POST",
    official: hermes({ route: "/lockfile-pin-delta", status: 405 }),
  }), { now: NOW });
  assert.equal(result.class, "wrong_method_or_path");
  assert.equal(result.reason, "method_mismatch");
  assert.equal(result.paidOperation.reason, "free_sufficient");
  assert.equal(result.paidOperation.paidAuditRequired, false);
});

test("a different path is a wrong path, not compatibility", () => {
  const result = classifyClientCompatibility(base({
    declaredRoute: "/.well-known/skills/index.json",
    binding: binding({ route: "/missing" }),
  }), { now: NOW });
  assert.equal(result.class, "wrong_method_or_path");
  assert.equal(result.reason, "wrong_path");
});

test("an unpaid 402 without accepts is a malformed contract and does not require purchase", () => {
  const result = classifyClientCompatibility(base({
    binding: binding({ clientId: "node-https", clientVersion: "v22.14.0", origin: "https://agents.samedaydesk.com", route: "/extract" }),
    payment: { status: 402, parsed: false, acceptCount: 0 },
  }), { now: NOW });
  assert.equal(result.class, "malformed_payment_contract");
  assert.equal(result.reason, "unpaid_challenge_has_no_accepts");
  assert.equal(result.paidOperation.paidAuditRequired, false);
  assert.equal(result.paidOperation.executed, false);
});

test("a held seller-integrity schema finding is consumed and not purchased again", () => {
  const result = classifyClientCompatibility(base({
    binding: binding({ clientId: "node-https", clientVersion: "v22.14.0" }),
    sellerIntegrity: {
      product: "samedaydesk-seller-integrity-audit",
      decision: "repair_required",
      report: { auditCompleted: true, valid: false, findings: ["x402_payment_required_schema_invalid"] },
    },
  }), { now: NOW });
  assert.equal(result.class, "malformed_payment_contract");
  assert.equal(result.consumedHeldReport, true);
  assert.equal(result.readiness.heldDecision, "repair_required");
  assert.equal(result.readiness.establishesClientCompatibility, false);
  assert.equal(result.paidOperation.paidAuditRequired, false);
});

test("an incomplete seller-integrity audit is not useful authority", () => {
  const result = classifyClientCompatibility(base({
    binding: binding({ clientId: "node-https", clientVersion: "v22.14.0" }),
    sellerIntegrity: {
      product: "samedaydesk-seller-integrity-audit",
      decision: "repair_required",
      report: { auditCompleted: false, failureCode: "bounded_transport_failure", findings: ["bounded_transport_failure"] },
    },
  }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "incomplete_audit_not_authority");
  assert.equal(result.incompleteAuditUseful, false);
  assert.equal(result.consumedHeldReport, true);
});

test("a readable index with a missing support file is incomplete, not a refusal", () => {
  const result = classifyClientCompatibility(base({
    official: hermes({ status: 200, installed: null, exitCode: null, supportMissing: ["scripts/lock-and-capture.mjs"], headers: { "content-type": "application/json" } }),
  }), { now: NOW });
  assert.equal(result.class, "incomplete_public_support_files");
  assert.equal(result.paidOperation.reason, "free_sufficient");
});

test("an observation outside the freshness horizon is stale", () => {
  const result = classifyClientCompatibility(base({
    freshForMs: 60_000,
    official: hermes({ observedAt: "2026-10-01T11:00:00.000Z" }),
    control: nodeControl({ observedAt: "2026-10-01T11:00:02.000Z" }),
  }), { now: NOW });
  assert.equal(result.class, "stale_observation");
  assert.equal(result.reason, "expired");
  assert.equal(result.nativeCompatible, false);
});

test("clocks more than five minutes apart are inconclusive", () => {
  const result = classifyClientCompatibility(base({
    official: hermes({ observedAt: "2026-10-01T11:40:00.000Z" }),
    control: nodeControl({ observedAt: "2026-10-01T11:50:30.000Z" }),
  }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "observation_clocks_diverge");
});

test("a held unpaid-door class does not become a native-client result or a purchase", () => {
  const result = classifyClientCompatibility(base({
    binding: binding({ clientId: "node-https", clientVersion: "v22.14.0" }),
    unpaidDoor: { doorClass: "method_mismatch", freeSufficient: true },
  }), { now: NOW });
  assert.equal(result.class, "inconclusive");
  assert.equal(result.reason, "unpaid_door_already_answers");
  assert.equal(result.consumedUnpaidDoorClass, "method_mismatch");
  assert.equal(result.paidOperation.paidAuditRequired, false);
});

test("fetched engines pin is evaluated and a supplied pin is not", () => {
  const fetched = classifyClientCompatibility(base({
    binding: binding({ clientId: "node-https", clientVersion: "v22.14.0" }),
    official: hermes({ clientId: "node-https", status: 200, installed: true, exitCode: null, headers: { "content-type": "application/json" } }),
    enginesNodePin: ">=22.20.0",
    pinSource: "fetched_bytes",
  }), { now: NOW });
  assert.equal(fetched.class, "compatible");
  assert.equal(fetched.enginePinSatisfied, false);
  assert.equal(fetched.pinVerified, true);
  assert.equal(fetched.nativeCompatible, true);
});

test("changed task, client, and route invalidate a receipt", () => {
  const evidence = base({ official: hermes(), control: nodeControl(), receivedAt: NOW.toISOString() });
  const diagnosis = classifyClientCompatibility(evidence, { now: NOW });
  const bytes = Buffer.from(JSON.stringify(evidence));
  const receipt = buildReceipt(diagnosis, { evidenceBytes: bytes, taskText: TASK });
  const accepted = checkDecisionReceipt(receipt, { taskText: TASK, evidence, evidenceBytes: bytes, now: NOW, binding: evidence.binding });
  assert.equal(accepted.exitCode, 0);
  assert.equal(accepted.class, "accept");
  assert.equal(accepted.cdnPolicyConfirmed, false);
  const changedTask = checkDecisionReceipt(receipt, {
    taskText: `${TASK} The route is now a different skill index.`,
    evidence,
    evidenceBytes: bytes,
    now: NOW,
  });
  assert.equal(changedTask.exitCode, 4);
  assert.equal(changedTask.reason, "changed_task");
  assert.equal(changedTask.class, "stale_observation");
  const changedClient = checkDecisionReceipt(receipt, {
    taskText: TASK,
    evidence,
    evidenceBytes: bytes,
    now: NOW,
    binding: binding({ clientVersion: "0.21.5" }),
  });
  assert.equal(changedClient.exitCode, 4);
  assert.equal(changedClient.reason, "changed_client");
  const changedRoute = checkDecisionReceipt(receipt, {
    taskText: TASK,
    evidence,
    evidenceBytes: bytes,
    now: NOW,
    binding: binding({ route: "/.well-known/skills/other/SKILL.md" }),
  });
  assert.equal(changedRoute.exitCode, 4);
  assert.equal(changedRoute.reason, "changed_route");
  const rewrittenBinding = {
    ...receipt,
    binding: { ...receipt.binding, route: "/.well-known/skills/other.json" },
  };
  const rewritten = checkDecisionReceipt(rewrittenBinding, { taskText: TASK, evidence, evidenceBytes: bytes, now: NOW });
  assert.equal(rewritten.exitCode, 3);
  assert.equal(rewritten.reason, "stored_binding_does_not_match_evidence");
  const rewrittenId = checkDecisionReceipt(
    { ...receipt, requestId: "not-a-captured-id" },
    { taskText: TASK, evidence, evidenceBytes: bytes, now: NOW },
  );
  assert.equal(rewrittenId.exitCode, 3);
  assert.equal(rewrittenId.reason, "stored_class_does_not_match_evidence");
  const executed = checkDecisionReceipt(
    { ...receipt, nextAction: { ...receipt.nextAction, executed: true } },
    { taskText: TASK, evidence, evidenceBytes: bytes, now: NOW },
  );
  assert.equal(executed.exitCode, 3);
  assert.equal(executed.reason, "next_action_executed");
});

test("seeded false claims are rejected", () => {
  const evidence = base({ official: hermes(), control: nodeControl(), receivedAt: NOW.toISOString() });
  const diagnosis = classifyClientCompatibility(evidence, { now: NOW });
  const bytes = Buffer.from(JSON.stringify(evidence));
  const receipt = { ...buildReceipt(diagnosis, { evidenceBytes: bytes, taskText: TASK }) };
  for (const [field, value, code] of [
    ["cdnPolicyConfirmed", true, "cdn_policy_claim"],
    ["nativeCompatible", true, "false_native_compatible"],
    ["paidAuditRequired", true, "paid_audit_required"],
    ["independentDemandConfirmed", true, "independent_demand_claim"],
    ["presentedAsFreshPaidExecution", true, "fresh_paid_execution_claim"],
    ["paymentSent", true, "payment_sent"],
  ]) {
    const seeded = { ...receipt, [field]: value };
    const checked = checkDecisionReceipt(seeded, { taskText: TASK, evidence, evidenceBytes: bytes, now: NOW });
    assert.equal(checked.exitCode, 3, field);
    assert.equal(checked.reason, code);
  }
});

test("redirects are not followed and private hosts are rejected", async () => {
  const redirected = await replayNodeHttps("https://example.com/index.json", {
    requestImpl: async () => ({ status: 302, headers: { location: "https://example.com/secret?token=1" }, body: Buffer.alloc(0) }),
  });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.redirectsFollowed, false);
  assert.equal(redirected.bodyRetained, false);
  const classified = classifyClientCompatibility(base({
    official: hermes({ status: 302, exitCode: null, installed: null, headers: { location: "https://example.com/secret?token=1" } }),
  }), { now: NOW });
  assert.equal(classified.class, "inconclusive");
  assert.equal(classified.reason, "redirect_not_followed");
  assert.doesNotMatch(JSON.stringify(classified), /token=1/);
  await assert.rejects(
    replayNodeHttps("https://127.0.0.1/index.json"),
    (error) => error.code === "ssrf_rejected",
  );
  await assert.rejects(
    replayNodeHttps("https://example.com/index.json?q=1"),
    (error) => error.code === "query_rejected",
  );
});

test("a third overlapping replay is rejected", async () => {
  resetReplaySlotsForTests();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const response = { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{\"skills\":[]}") };
  const first = replayNodeHttps("https://example.com/one", { requestImpl: () => gate.then(() => response) });
  const second = replayNodeHttps("https://example.com/two", { requestImpl: () => gate.then(() => response) });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    replayNodeHttps("https://example.com/three", { requestImpl: async () => response }),
    (error) => error.code === "concurrency_rejected",
  );
  release();
  const done = await Promise.all([first, second]);
  assert.equal(done[0].status, 200);
  assert.equal(done[0].bodyRetained, false);
  assert.equal(done[0].support.indexParsed, true);
  resetReplaySlotsForTests();
});
