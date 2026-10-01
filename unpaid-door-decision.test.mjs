import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  actorClaim,
  buildReceipt,
  checkDecisionReceipt,
  classifyAttempt,
  classifyUnpaidDoor,
  evaluateEvidence,
  freeCatalogFacts,
  taskDigest,
  usdToUsdcAtomic,
} from "./unpaid-door-decision.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const evidencePath = path.join(cwd, "examples/unpaid-door-decision/evidence/2026-10-01-public-replay.json");
const taskPath = path.join(cwd, "examples/unpaid-door-decision/TASK.txt");
const receiptPath = path.join(cwd, "examples/unpaid-door-decision/receipt.json");

function runCli(args) {
  const child = spawn(process.execPath, ["examples/unpaid-door-decision/cli.mjs", ...args], { cwd });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end();
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

function seeded(patch) {
  return {
    id: "seeded-row",
    source: "seeded observation for a rejected or free-sufficient edge",
    evidenceClass: "seeded",
    method: "GET",
    urlPath: "/paid",
    status: 402,
    payment: { parsed: true, acceptCount: 1, scheme: "exact", amountAtomic: "10000", network: "eip155:8453", baseUsdc: true },
    requiredPaths: [],
    ...patch,
  };
}

test("public replay is free-sufficient and does not require the paid audit", async () => {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const evaluated = evaluateEvidence(evidence);
  assert.equal(evaluated.criterion.ok, true);
  assert.equal(evaluated.criterion.publicRows, evidence.rows.length);
  assert.equal(evaluated.criterion.paidAuditRequired, 0);
  assert.equal(evaluated.criterion.cashUsd, 0);
  assert.equal(evaluated.rows.every((row) => row.independentDemandConfirmed === false && row.purchaseAuthorized === false && row.paymentSent === false), true);
  const byId = Object.fromEntries(evaluated.rows.map((row) => [row.id, row]));
  assert.equal(byId["t1-bronzetti-brief"].doorClass, "payable");
  assert.equal(byId["t1-bronzetti-brief"].catalogComparison, "agree");
  assert.equal(byId["t1-bronzetti-brief"].responseContract, "declared_in_free_schema");
  assert.equal(byId["issue3249-root"].doorClass, "false_routing");
  assert.deepEqual(byId["issue3249-root"].also, ["402_sans_accepts"]);
  assert.equal(byId["issue3249-manifest"].doorClass, "402_sans_accepts");
  assert.equal(byId["issue3249-canonical"].doorClass, "402_sans_accepts");
  assert.equal(byId["merchant-extract"].doorClass, "payable");
  assert.equal(byId["merchant-extract"].catalogComparison, "agree");
  assert.equal(byId["merchant-extract"].responseContract, "declared_in_free_schema");
  assert.equal(byId["merchant-healthz"].doorClass, "free_or_open");
  assert.equal(byId["merchant-audit-door"].doorClass, "payable");
  assert.equal(byId["merchant-audit-door"].paidAuditRequired, false);
  assert.equal(byId["merchant-manifest"].doorClass, "missing_route");
  assert.equal(byId["merchant-lockfile-get"].doorClass, "method_mismatch");
  assert.equal(byId["merchant-lockfile-post"].doorClass, "payable");
  assert.equal(byId["merchant-mcp-get"].doorClass, "free_or_open");
  assert.equal(byId["minia2a-root"].doorClass, "free_or_open");
  assert.equal(evidence.mcp.sellerIntegrityAuditPresent, true);
  assert.equal(evidence.mcp.paymentAttempted, false);
  assert.equal(evidence.mcp.toolNames.includes("seller_integrity_audit"), true);
  assert.equal(evidence.demand.independentPaidSuccessActors, 0);
  assert.equal(evidence.demand.requestedWindowCoverage, "unknown_for_full_window");
  assert.equal(evidence.paymentSent, false);
});

test("changed terms, ambiguous offers, and visible catalog disagreement do not authorize payment", () => {
  const changed = classifyUnpaidDoor(seeded({
    priorTermsDigest: "a".repeat(64),
    liveTermsDigest: "b".repeat(64),
  }));
  assert.equal(changed.doorClass, "terms_changed");
  assert.equal(changed.paidAuditRequired, false);
  assert.equal(changed.nextAction.purchaseAuthorized, false);
  assert.equal(changed.nextAction.automaticFinancialAction, false);

  const ambiguous = classifyUnpaidDoor(seeded({
    payment: { parsed: true, acceptCount: 2, scheme: null, singleBaseNetwork: false, network: null, baseUsdc: null },
  }));
  assert.equal(ambiguous.doorClass, "terms_ambiguous");
  assert.equal(ambiguous.paidAuditRequired, false);

  const selected = classifyUnpaidDoor(seeded({
    payment: { parsed: true, acceptCount: 2, scheme: "exact", singleBaseNetwork: true, network: "eip155:8453", baseUsdc: true, amountAtomic: "5000" },
  }));
  assert.equal(selected.doorClass, "payable");
  assert.equal(selected.paymentSent, false);

  const disagree = classifyUnpaidDoor(seeded({
    catalog: { method: "GET", amountAtomic: "10000" },
    payment: { parsed: true, acceptCount: 1, scheme: "exact", amountAtomic: "20000", network: "eip155:8453", baseUsdc: true },
  }));
  assert.equal(disagree.doorClass, "payable");
  assert.equal(disagree.catalogComparison, "disagree");
  assert.equal(disagree.paidAuditRequired, false);

  const method = classifyUnpaidDoor(seeded({ catalog: { method: "POST" } }));
  assert.equal(method.doorClass, "catalog_method_disagreement");
  assert.equal(method.freeSufficient, true);

  const transport = classifyUnpaidDoor(seeded({ status: null, transportError: "timeout", payment: null }));
  assert.equal(transport.doorClass, "transport_failure");
  assert.equal(transport.paidAuditRequired, false);

  const redirect = classifyUnpaidDoor(seeded({ status: 302, payment: null }));
  assert.equal(redirect.doorClass, "redirect_unfollowed");

  const catalogMethodOnly = classifyUnpaidDoor(seeded({
    status: 404,
    allow: null,
    payment: { parsed: false, acceptCount: 0 },
    catalog: { method: "POST", schemaPresent: true },
  }));
  assert.equal(catalogMethodOnly.doorClass, "method_mismatch");
  assert.equal(catalogMethodOnly.paidAuditRequired, false);

  const missingPath = classifyUnpaidDoor(seeded({
    requiredPaths: ["data.id"],
    catalog: { method: "GET", schemaPresent: true, schemaRequired: ["ok"] },
  }));
  assert.equal(missingPath.responseContract, "not_declared_in_free_schema");
  assert.equal(missingPath.paidAuditRequired, false);

  const absent = classifyUnpaidDoor(seeded({
    requiredPaths: ["data.id"],
    catalog: { schemaPresent: false, schemaRequired: null },
  }));
  assert.equal(absent.responseContract, "free_schema_absent");
  assert.equal(absent.paidAuditRequired, false);
});

test("incomplete audits, failed delivery, and caller labels stay unqualified", () => {
  const target = { origin: "https://example.com", route: "/extract", method: "GET" };
  const incomplete = classifyAttempt({
    paymentPresent: true,
    status: 200,
    actor: "independent",
    target,
    body: {
      product: "samedaydesk-seller-integrity-audit",
      version: "1.3.0",
      decision: "repair_required",
      request: target,
      report: { auditCompleted: false, findings: ["openapi_unavailable"] },
      boundary: { targetPaymentSent: false },
    },
  });
  assert.equal(incomplete.class, "audit_incomplete");
  assert.equal(incomplete.usefulDelivery, false);
  assert.equal(incomplete.independentDemandConfirmed, false);
  assert.equal(incomplete.actorLabel, "independent");
  assert.equal(incomplete.actorLabelEvidence, "caller_claim");

  const failed = classifyAttempt({ paymentPresent: true, status: 502, actor: "owner_test" });
  assert.equal(failed.class, "delivery_failed");
  assert.equal(failed.usefulDelivery, false);
  assert.equal(failed.revenueRecognized, false);
  assert.equal(failed.financialOutcome, "unknown");

  const wallet = `0x${"ab".repeat(20)}`;
  assert.equal(actorClaim(wallet).actorLabel, "unknown");
  assert.equal(JSON.stringify(actorClaim(wallet)).includes(wallet), false);
  assert.equal(actorClaim("independent").independentDemandConfirmed, false);
});

test("receipt rejects seeded demand, incomplete usefulness, and a changed task", async () => {
  const evidenceBytes = await readFile(evidencePath);
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  const taskText = await readFile(taskPath, "utf8");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const accepted = checkDecisionReceipt(receipt, { taskText, evidence, evidenceBytes });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.class, "accept");
  assert.equal(receipt.taskDigest, taskDigest(taskText));
  assert.equal(receipt.paidDiagnosticChangesDecision, false);
  assert.equal(receipt.ownerQa, "unknown");
  assert.equal(receipt.sampleCapApplied, false);

  const rebuilt = buildReceipt({
    evidence,
    evidenceBytes,
    taskText,
    evidencePath: "examples/unpaid-door-decision/evidence/2026-10-01-public-replay.json",
  });
  assert.equal(rebuilt.evidenceDigest, receipt.evidenceDigest);
  assert.equal(rebuilt.decision, "paid_audit_not_required");
  assert.deepEqual(rebuilt.rows, receipt.rows);

  const demand = JSON.parse(await readFile(path.join(cwd, "examples/unpaid-door-decision/fixtures/seeded-independent-demand.json"), "utf8"));
  assert.equal(checkDecisionReceipt(demand, { taskText }).class, "independent-demand-claim");
  const incomplete = JSON.parse(await readFile(path.join(cwd, "examples/unpaid-door-decision/fixtures/seeded-incomplete-audit.json"), "utf8"));
  assert.equal(checkDecisionReceipt(incomplete, { taskText }).class, "incomplete-audit-counted-useful");
  const changed = checkDecisionReceipt(receipt, { taskText: `${taskText}\nA different consumer task.\n`, evidence, evidenceBytes });
  assert.equal(changed.ok, false);
  assert.equal(changed.class, "task_changed");
  assert.equal(changed.reusable, true);

  const overclaim = { ...receipt, decision: "paid_audit_required", paidDiagnosticChangesDecision: true };
  assert.equal(checkDecisionReceipt(overclaim, { taskText, evidence, evidenceBytes }).class, "paid-audit-overclaim");
});

test("free catalog facts resolve one local schema ref and the USDC assumption", () => {
  assert.equal(usdToUsdcAtomic("0.02"), "20000");
  assert.equal(usdToUsdcAtomic("0.005"), "5000");
  assert.equal(usdToUsdcAtomic("0.020"), "20000");
  assert.equal(usdToUsdcAtomic("nope"), null);
  const facts = freeCatalogFacts({
    paths: { "/premium/agent-brief": { get: { responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/AgentDecisionSignal" } } } } }, "x-payment-info": { price: { currency: "USD", amount: "0.02" } } } } },
    components: { schemas: { AgentDecisionSignal: { type: "object", required: ["decision", "next_action"] } } },
  }, "/premium/agent-brief");
  assert.equal(facts.method, "GET");
  assert.equal(facts.amountUsd, "0.02");
  assert.deepEqual(facts.schemaRequired, ["decision", "next_action"]);
  const missing = freeCatalogFacts({ paths: {} }, "/missing");
  assert.equal(missing.routeDeclared, false);
  assert.equal(missing.schemaPresent, false);
});

test("cli replay accepts the receipt and rejects the seeded failures", async () => {
  const replay = await runCli(["replay"]);
  assert.equal(replay.code, 0, replay.stderr || replay.stdout);
  const replayBody = JSON.parse(replay.stdout);
  assert.equal(replayBody.criterion.ok, true);
  assert.equal(replayBody.paymentSent, false);
  assert.equal(replayBody.rows.some((row) => row.paidAuditRequired), false);

  const accepted = await runCli(["check-receipt", "--receipt", "examples/unpaid-door-decision/receipt.json"]);
  assert.equal(accepted.code, 0, accepted.stdout);
  assert.equal(JSON.parse(accepted.stdout).class, "accept");

  const demand = await runCli(["check-receipt", "--receipt", "examples/unpaid-door-decision/fixtures/seeded-independent-demand.json"]);
  assert.equal(demand.code, 3, demand.stdout);
  assert.equal(JSON.parse(demand.stdout).class, "independent-demand-claim");

  const incomplete = await runCli(["check-receipt", "--receipt", "examples/unpaid-door-decision/fixtures/seeded-incomplete-audit.json"]);
  assert.equal(incomplete.code, 3, incomplete.stdout);
  assert.equal(JSON.parse(incomplete.stdout).class, "incomplete-audit-counted-useful");
});
