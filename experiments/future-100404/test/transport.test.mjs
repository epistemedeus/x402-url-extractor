import test from "node:test";
import assert from "node:assert/strict";
import { contract } from "./caller.mjs";
import { startMounted } from "./mounted-owner.mjs";
import { executeDelivery, evaluateReceipt } from "../src/consumer.mjs";
import { serviceOrigin } from "../src/transport.mjs";

const options = { allowLoopback: true };
test("transport refuses credentials, redirects, noncanonical origins and arbitrary remote services", async () => {
  for (const origin of ["http://127.0.0.1:80", "https://agents.samedaydesk.com/path", "https://user:pass@agents.samedaydesk.com",
    "https://agents.samedaydesk.com?grant=hidden", "https://other.invalid", "http://2130706433:80"]) {
    assert.throws(() => serviceOrigin(origin));
  }
  assert.throws(() => serviceOrigin("http://2130706433:80", options));
  const f = await startMounted({ intercept(req, res, next, state) {
    if (req.path === "/commerce/scoped-surface-scan") return res.redirect(302, "/trap");
    if (req.path === "/trap") { state.trap = true; return res.json({ paidValidDelivery: true }); }
    next();
  } });
  try {
    const r = await executeDelivery(contract(), f.origin, options);
    assert.equal(r.observations.execution.reason, "redirect_refused");
    assert.equal(f.state.trap, undefined);
    assert.equal(evaluateReceipt(r).paymentPermitted, false);
  } finally { await f.close(); }
});
test("one deadline covers the release reads and execution; unknown replies are never automatically replayed", async () => {
  const f = await startMounted({ intercept(req, res, next) {
    if (req.path === "/.well-known/agent-payment-evidence.json") {
      const timer = setTimeout(next, 40); res.once("close", () => clearTimeout(timer)); return;
    }
    if (req.path === "/commerce/scoped-surface-scan") {
      const timer = setTimeout(() => res.json({ incomplete: true }), 80); res.once("close", () => clearTimeout(timer)); return;
    }
    next();
  } });
  try {
    const c = contract(); c.expectations.maxLatencyMs = 60; c.expectations.deadlineMs = 60;
    const start = performance.now(); const r = await executeDelivery(c, f.origin, options);
    assert.ok(performance.now() - start < 600);
    assert.equal(r.observations.execution.reason, "deadline");
    assert.equal(evaluateReceipt(r).attemptOutcome, "reply_outcome_unknown");
    assert.equal(f.state.requests.filter(r => r.method === "POST").length, 1);
    assert.equal(evaluateReceipt(r).automaticReplay, false);
  } finally { await f.close(); }
});
test("slow release acquisition is included in caller latency even when the service result is prompt", async () => {
  const f = await startMounted({ intercept(req, res, next) {
    if (req.path === "/.well-known/agent-payment-evidence.json") {
      const timer = setTimeout(next, 100); res.once("close", () => clearTimeout(timer)); return;
    }
    next();
  } });
  try {
    const c = contract(); c.expectations.maxLatencyMs = 150;
    const e = evaluateReceipt(await executeDelivery(c, f.origin, options));
    assert.equal(e.latency.state, "unmet");
    assert.equal(e.usefulOutput, "met");
    assert.ok(e.latency.elapsedMs >= 200);
    assert.equal(e.verdict, "partial");
  } finally { await f.close(); }
});
test("bounded body, malformed JSON, missing output and service unavailability preserve their distinct meanings", async () => {
  for (const variant of ["large", "malformed", "http200", "down"]) {
    const f = await startMounted({ intercept(req, res, next) {
      if (req.path !== "/commerce/scoped-surface-scan") return next();
      if (variant === "large") return res.json({ text: "x".repeat(300000) });
      if (variant === "malformed") return res.type("application/json").send("{unfinished");
      if (variant === "http200") return res.json({ httpStatus: 200, paidValidDelivery: true });
      return res.status(503).json({ error: "service_unavailable" });
    } });
    try {
      const r = await executeDelivery(contract(), f.origin, options); const e = evaluateReceipt(r);
      assert.notEqual(e.verdict, "fulfilled");
      if (variant === "large") assert.equal(r.observations.execution.state, "partial");
      if (variant === "malformed") assert.equal(r.observations.execution.reason, "malformed_response");
      if (variant === "http200") { assert.equal(e.usefulOutput, "unknown"); assert.equal(e.executionBinding.state, "unknown"); }
      if (variant === "down") assert.equal(e.delivery, "unavailable");
      assert.equal(e.makeGood.financialAction, "none");
    } finally { await f.close(); }
  }
});
test("wrong-task output and cancellation cannot fulfill a contract", async () => {
  const f = await startMounted({ intercept(req, res, next) {
    if (req.path !== "/commerce/scoped-surface-scan") return next();
    res.json({ report: { schema: "samedaydesk.scoped-surface.v1", taskId: "other", callerId: "caller-one", contextId: "private-one",
      scanPerformed: true, concern: { result: "no_match" } } });
  } });
  try {
    const e = evaluateReceipt(await executeDelivery(contract(), f.origin, options));
    assert.equal(e.usefulOutput, "met"); assert.equal(e.executionBinding.state, "unmet"); assert.equal(e.verdict, "partial");
    const controller = new AbortController(); controller.abort();
    const cancelled = await executeDelivery(contract(), f.origin, { ...options, signal: controller.signal });
    assert.equal(cancelled.observations.execution.attempted, false);
    assert.equal(cancelled.observations.execution.reason, "cancelled");
  } finally { await f.close(); }
});
