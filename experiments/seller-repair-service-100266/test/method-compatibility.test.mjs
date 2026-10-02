import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { executeCallerRequest, resolveLater } from "../commercial/caller-request.mjs";

const repo = join(import.meta.dirname, "..", "..", "..");
const exp = join(repo, "experiments", "seller-repair-service-100266");
const node = process.execPath;
const fresh = {
  observedAt: "2026-10-02T09:00:00.000Z",
  expiresAt: "2026-10-03T09:00:00.000Z",
  evaluatedAt: "2026-10-02T12:00:00.000Z",
};

function requestFor(overrides = {}) {
  return {
    schema: "samedaydesk.seller-repair-caller-request.v1",
    callerId: "method-visitor",
    task: "Decide whether the supplied discovering method and intended method describe one compatible invocation.",
    origin: "https://widget.example",
    operation: "GET /v1/alpha",
    sdk: "node-https@22",
    runtime: "node/22.22.2",
    expect: { path: "status", value: "ready" },
    limits: {
      probes: 4,
      bodyBytes: 4096,
      deadlineMs: 1000,
      totalBodyBytes: 16384,
      totalResponseMs: 4000,
      redirects: 0,
      outputBytes: 65536,
    },
    question: "useful_output",
    paidIntent: false,
    observed: { status: 402, contentType: "application/json", json: { error: "Payment required" } },
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    discoveringMethod: "GET",
    intendedInvocationMethod: "GET",
    declaredMethods: ["GET"],
    acceptedMethods: ["GET"],
    bodyShape: { hasBody: false, invokeWithBody: false, originAgreement: null, headerOnly: false },
    client: { profile: "node-http", retry: "prepared_request" },
    freshness: fresh,
    ...overrides,
  };
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server) {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(() => resolve()));
}

test("same, different, and missing methods stay evidence, not spend authority", async () => {
  const same = await executeCallerRequest(requestFor({ methodBinding: binding() }));
  assert.equal(same.exitCode, 0);
  assert.equal(same.receipt.methodCompatibility.decision, "compatible");
  assert.equal(same.receipt.methodCompatibility.reason, "challenge_is_not_an_order");
  assert.ok(same.receipt.methodCompatibility.limitations.includes("challenge_is_not_an_order"));
  assert.equal(same.receipt.methodCompatibility.safeToPay, false);
  assert.equal(same.receipt.methodCompatibility.paymentAuthorized, false);
  assert.equal(same.receipt.methodCompatibility.signingAuthorized, false);
  assert.equal(same.receipt.methodCompatibility.order, false);
  assert.equal(same.receipt.methodCompatibility.networkIsMethodResult, false);
  assert.equal(same.receipt.purchaseRecommended, false);
  assert.equal(same.receipt.paymentSent, false);

  const different = await executeCallerRequest(requestFor({
    methodBinding: binding({
      acceptedMethods: ["POST"],
      declaredMethods: ["POST"],
    }),
  }));
  assert.equal(different.receipt.methodCompatibility.decision, "mismatch");
  assert.equal(different.receipt.methodCompatibility.reason, "method_disagrees");
  assert.equal(different.receipt.methodCompatibility.retryOfSameOperation, true);
  assert.equal(different.receipt.methodCompatibility.operationRelation, "same_operation_retry");
  assert.equal(different.receipt.methodCompatibility.safeToPay, false);

  const missing = await executeCallerRequest(requestFor({
    methodBinding: binding({
      discoveringMethod: null,
      intendedInvocationMethod: null,
      declaredMethods: null,
      acceptedMethods: null,
      bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: true },
    }),
  }));
  assert.equal(missing.receipt.methodCompatibility.decision, "unknown");
  assert.equal(missing.receipt.methodCompatibility.reason, "insufficient_input");
  assert.equal(missing.receipt.methodCompatibility.inferredMethod, null);
  assert.equal(missing.receipt.methodCompatibility.independentlyExecuted, false);
  assert.equal(missing.receipt.classification.useful, false);
});

test("method tokens normalize without changing the decision", async () => {
  const lower = await executeCallerRequest(requestFor({
    methodBinding: binding({ discoveringMethod: "get", intendedInvocationMethod: "Get", acceptedMethods: ["get"], declaredMethods: ["GET"] }),
  }));
  const upper = await executeCallerRequest(requestFor({ methodBinding: binding() }));
  assert.equal(lower.receipt.methodCompatibility.discoveringMethod, "GET");
  assert.equal(lower.receipt.methodCompatibility.decision, upper.receipt.methodCompatibility.decision);
  assert.equal(lower.receipt.methodCompatibility.bindingDigest, upper.receipt.methodCompatibility.bindingDigest);
});

test("a changed operation does not inherit the previous retry disagreement", async () => {
  const first = await executeCallerRequest(requestFor({
    operation: "GET /v1/old",
    methodBinding: binding({ acceptedMethods: ["POST"], declaredMethods: ["POST"] }),
  }));
  assert.equal(first.receipt.methodCompatibility.decision, "mismatch");
  const secondInput = requestFor({
    operation: "GET /v1/new",
    methodBinding: binding({
      discoveringMethod: "POST",
      intendedInvocationMethod: "POST",
      declaredMethods: ["POST"],
      acceptedMethods: ["POST"],
      priorOperation: { resource: "/v1/old", method: "GET" },
    }),
  });
  const second = await executeCallerRequest(secondInput);
  assert.equal(second.receipt.methodCompatibility.decision, "compatible");
  assert.equal(second.receipt.methodCompatibility.operationRelation, "changed_operation");
  assert.equal(second.receipt.methodCompatibility.priorDisagreementApplies, false);
  assert.equal(second.receipt.methodCompatibility.retryOfSameOperation, false);
  assert.equal(second.receipt.methodCompatibility.safeToPay, false);
  const later = await resolveLater(first.artifact, secondInput);
  assert.equal(later.executed, true);
  assert.equal(later.predicateApplies, false);
  assert.equal(later.reason, "stale_applicability");
  assert.equal(later.receipt.methodCompatibility.decision, "compatible");
  assert.equal(later.paymentSent, false);
  assert.equal(later.receipt.methodCompatibility.safeToPay, false);
});

test("undeclared body semantics stay unknown and an explicit origin agreement can be compatible", async () => {
  const undeclared = await executeCallerRequest(requestFor({
    methodBinding: binding({
      bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: null, originAgreement: null, headerOnly: false },
      client: { profile: "node-http", retry: "prepared_request" },
    }),
  }));
  assert.equal(undeclared.receipt.methodCompatibility.decision, "unknown");
  assert.equal(undeclared.receipt.methodCompatibility.reason, "body_semantics_undeclared");
  assert.equal(undeclared.receipt.methodCompatibility.inferredMethod, null);
  assert.equal(undeclared.receipt.methodCompatibility.protocolForbidsMethodBody, false);

  const agreed = await executeCallerRequest(requestFor({
    methodBinding: binding({
      bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: true, originAgreement: true, headerOnly: false },
      client: { profile: "node-http", retry: "prepared_request" },
    }),
  }));
  assert.equal(agreed.receipt.methodCompatibility.decision, "compatible");
  assert.equal(agreed.receipt.methodCompatibility.reason, "origin_body_agreement");
  assert.equal(agreed.receipt.methodCompatibility.protocolForbidsMethodBody, false);
  assert.equal(agreed.receipt.methodCompatibility.safeToPay, false);
  assert.notEqual(undeclared.receipt.methodCompatibility.bindingDigest, agreed.receipt.methodCompatibility.bindingDigest);
});

test("Fetch cannot send a GET or HEAD body, and a header-only resource can still agree", async () => {
  let fetchGet = null;
  let fetchHead = null;
  try {
    await fetch("http://127.0.0.1:9/", { method: "GET", body: "{}" });
  } catch (error) {
    fetchGet = error;
  }
  try {
    await fetch("http://127.0.0.1:9/", { method: "HEAD", body: "{}" });
  } catch (error) {
    fetchHead = error;
  }
  assert.equal(fetchGet instanceof TypeError, true);
  assert.match(fetchGet.message, /GET\/HEAD method cannot have body/);
  assert.match(fetchHead.message, /GET\/HEAD method cannot have body/);

  const blocked = await executeCallerRequest(requestFor({
    methodBinding: binding({
      bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: true, originAgreement: true, headerOnly: false },
      client: { profile: "Fetch", retry: "prepared_request" },
    }),
  }));
  assert.equal(blocked.receipt.methodCompatibility.decision, "mismatch");
  assert.equal(blocked.receipt.methodCompatibility.reason, "fetch_unsupported_get_head_body");
  assert.equal(blocked.receipt.methodCompatibility.protocolForbidsMethodBody, false);
  assert.equal(blocked.receipt.methodCompatibility.safeToPay, false);

  const head = await executeCallerRequest(requestFor({
    methodBinding: binding({
      discoveringMethod: "HEAD",
      intendedInvocationMethod: "HEAD",
      declaredMethods: ["HEAD"],
      acceptedMethods: ["HEAD"],
      bodyShape: { hasBody: false, invokeWithBody: false, originAgreement: null, headerOnly: true },
      client: { profile: "fetch", retry: "prepared_request" },
    }),
  }));
  assert.equal(head.receipt.methodCompatibility.decision, "compatible");
  assert.equal(head.receipt.methodCompatibility.reason, "header_only_resource");
  assert.equal(head.receipt.methodCompatibility.safeToPay, false);
  assert.equal(head.receipt.order, false);
});

test("expired, partial, and inconsistent evidence cannot be executed or paid", async () => {
  const expired = await executeCallerRequest(requestFor({
    methodBinding: binding({
      freshness: {
        observedAt: "2026-10-01T00:00:00.000Z",
        expiresAt: "2026-10-02T00:00:00.000Z",
        evaluatedAt: "2026-10-02T12:00:00.000Z",
      },
    }),
  }));
  assert.equal(expired.receipt.methodCompatibility.decision, "unknown");
  assert.equal(expired.receipt.methodCompatibility.reason, "evidence_not_current");
  assert.equal(expired.receipt.methodCompatibility.independentlyExecuted, false);
  assert.equal(expired.receipt.methodCompatibility.safeToPay, false);

  const inconsistent = await executeCallerRequest(requestFor({
    methodBinding: binding({
      bodyShape: { headerOnly: true, invokeWithBody: true, hasBody: false },
    }),
  }));
  assert.equal(inconsistent.receipt.methodCompatibility.decision, "unknown");
  assert.equal(inconsistent.receipt.methodCompatibility.reason, "inconsistent_evidence");
  assert.equal(inconsistent.receipt.methodCompatibility.independentlyExecuted, false);
});

test("a seeded safeToPay flag is refused before any probe", async () => {
  const seeded = await executeCallerRequest(requestFor({ safeToPay: true, methodBinding: binding() }));
  assert.equal(seeded.exitCode, 2);
  assert.equal(seeded.executed, false);
  assert.equal(seeded.reason, "seeded_spend_claim");
  assert.equal(seeded.artifact, null);
  assert.equal(seeded.receipt.safeToPay, false);
  assert.equal(seeded.receipt.paymentSent, false);
  assert.equal(seeded.receipt.order, false);
  assert.equal(seeded.probed, false);
});

test("loopback write-method contracts observe the method and spend no payment header", async () => {
  const seen = [];
  const server = await listen((req, res) => {
    seen.push({ method: req.method, payment: req.headers["payment-signature"] || null, body: 0 });
    req.on("data", (chunk) => {
      seen[seen.length - 1].body += chunk.length;
    });
    const path = new URL(req.url, "http://127.0.0.1").pathname;
    if (path === "/openapi.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    if (req.method === "POST") {
      res.writeHead(402, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Payment required" }));
      return;
    }
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "method" }));
  });
  try {
    const result = await executeCallerRequest(requestFor({
      observed: undefined,
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${server.address().port}` },
      methodBinding: binding({
        discoveringMethod: "GET",
        intendedInvocationMethod: "POST",
        declaredMethods: ["POST"],
        acceptedMethods: ["POST"],
        localContract: true,
        client: { profile: "node-http", retry: "prepared_request" },
      }),
    }));
    assert.equal(result.exitCode, 0, JSON.stringify(result.receipt));
    assert.equal(result.receipt.methodCompatibility.decision, "mismatch");
    assert.equal(result.receipt.methodCompatibility.reason, "method_disagrees");
    assert.equal(result.receipt.methodCompatibility.independentlyExecuted, true);
    assert.equal(result.receipt.methodCompatibility.safeToPay, false);
    assert.equal(result.receipt.paymentSent, false);
    assert.equal(result.receipt.retest.deployedCounterpartyRepair, false);
    assert.ok(seen.some((row) => row.method === "POST"));
    assert.ok(seen.every((row) => row.payment == null && row.body === 0));
  } finally {
    await close(server);
  }
});

test("deadline, body, output, and probe budgets do not become a repair", async () => {
  const slow = await listen((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ready" }));
    }, 400);
  });
  try {
    const deadline = await executeCallerRequest(requestFor({
      observed: undefined,
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${slow.address().port}` },
      limits: {
        probes: 2, bodyBytes: 1024, deadlineMs: 40, totalBodyBytes: 2048, totalResponseMs: 80, redirects: 0, outputBytes: 65536,
      },
      methodBinding: binding({ localContract: true }),
    }));
    assert.equal(deadline.receipt.methodCompatibility.decision, "unknown");
    assert.equal(deadline.receipt.methodCompatibility.reason, "body_deadline");
    assert.equal(deadline.receipt.methodCompatibility.independentlyExecuted, false);
    assert.equal(deadline.receipt.methodCompatibility.safeToPay, false);
    assert.equal(deadline.receipt.purchaseRecommended, false);
  } finally {
    await close(slow);
  }

  const fat = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ready", pad: "x".repeat(80) }));
  });
  try {
    const body = await executeCallerRequest(requestFor({
      observed: undefined,
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${fat.address().port}` },
      limits: {
        probes: 2, bodyBytes: 32, deadlineMs: 1000, totalBodyBytes: 64, totalResponseMs: 2000, redirects: 0, outputBytes: 65536,
      },
      methodBinding: binding({ localContract: true }),
    }));
    assert.equal(body.receipt.methodCompatibility.reason, "body_ceiling");
    assert.equal(body.receipt.methodCompatibility.independentlyExecuted, false);
    assert.equal(body.receipt.methodCompatibility.safeToPay, false);
  } finally {
    await close(fat);
  }

  const counted = [];
  const once = await listen((req, res) => {
    counted.push(req.method);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ready" }));
  });
  try {
    const budget = await executeCallerRequest(requestFor({
      observed: undefined,
      probeConsent: { class: "loopback", confirmed: true, baseUrl: `http://127.0.0.1:${once.address().port}` },
      limits: {
        probes: 1, bodyBytes: 1024, deadlineMs: 1000, totalBodyBytes: 2048, totalResponseMs: 2000, redirects: 0, outputBytes: 65536,
      },
      methodBinding: binding({
        discoveringMethod: "GET",
        intendedInvocationMethod: "POST",
        declaredMethods: ["POST"],
        acceptedMethods: ["POST"],
        localContract: true,
      }),
    }));
    assert.equal(budget.receipt.methodCompatibility.reason, "probe_budget");
    assert.equal(budget.receipt.methodCompatibility.evidenceQuality, "partial");
    assert.equal(budget.receipt.methodCompatibility.independentlyExecuted, false);
    assert.deepEqual(counted, ["GET"]);
  } finally {
    await close(once);
  }

  const ceiling = await executeCallerRequest(requestFor({
    limits: {
      probes: 2, bodyBytes: 1024, deadlineMs: 1000, totalBodyBytes: 2048, totalResponseMs: 2000, redirects: 0, outputBytes: 512,
    },
    methodBinding: binding(),
  }));
  assert.equal(ceiling.receipt.reason, "output_ceiling");
  assert.equal(ceiling.artifact, null);
  assert.equal(JSON.stringify(ceiling.receipt).includes('"safeToPay":true'), false);
  assert.equal(ceiling.receipt.paymentSent, false);
});

test("the two retained captures run through deliver --request", async () => {
  const deliver = (file) => spawnSync(node, [
    join(exp, "bin", "commercial-path.mjs"),
    "deliver",
    "--request",
    join(exp, "cases", file),
  ], { cwd: repo, encoding: "utf8" });
  const ged = deliver("method-gedx402-3511.json");
  assert.equal(ged.status, 0, ged.stderr || ged.stdout);
  const gedBody = JSON.parse(ged.stdout);
  assert.equal(gedBody.methodCompatibility.decision, "mismatch");
  assert.equal(gedBody.methodCompatibility.reason, "declaration_follows_probe");
  assert.ok(gedBody.methodCompatibility.limitations.includes("fetch_unsupported_get_head_body"));
  assert.equal(gedBody.methodCompatibility.challengeAmount, "1000");
  assert.equal(gedBody.methodCompatibility.ourPrice, null);
  assert.equal(gedBody.methodCompatibility.order, false);
  assert.equal(gedBody.methodCompatibility.safeToPay, false);
  assert.equal(gedBody.methodCompatibility.protocol.network, "eip155:8453");
  assert.equal(gedBody.methodCompatibility.networkIsMethodResult, false);
  assert.equal(gedBody.methodCompatibility.independentlyExecuted, false);
  assert.equal(gedBody.methodCompatibility.inferredMethod, null);
  assert.equal(gedBody.classification.reason, "paid_body_not_read");
  assert.equal(gedBody.purchaseRecommended, false);
  assert.equal(gedBody.paid.priceAtomic, "10000");
  assert.notEqual(gedBody.methodCompatibility.challengeAmount, gedBody.paid.priceAtomic);
  assert.equal(gedBody.methodCompatibility.reproduction.hosted, false);
  assert.match(ged.stdout, /deliver --request/);
  assert.equal(ged.stdout.includes("PAYMENT-SIGNATURE"), false);

  const historical = deliver("method-issue-3657.json");
  assert.equal(historical.status, 0, historical.stderr || historical.stdout);
  const old = JSON.parse(historical.stdout);
  assert.equal(old.methodCompatibility.decision, "unknown");
  assert.equal(old.methodCompatibility.reason, "historical_report_not_current");
  assert.equal(old.methodCompatibility.ongoingOutage, false);
  assert.equal(old.methodCompatibility.proposedCounterpartyRepair, false);
  assert.equal(old.methodCompatibility.reportedRepair.verifiedByUs, false);
  assert.equal(old.methodCompatibility.reportedRepair.getPaymentSettled, true);
  assert.equal(old.methodCompatibility.historical.decision, "mismatch");
  assert.equal(old.methodCompatibility.historical.reason, "method_disagrees");
  assert.equal(old.methodCompatibility.historical.appliesNow, false);
  assert.equal(old.methodCompatibility.safeToPay, false);
  assert.equal(old.methodCompatibility.independentlyExecuted, false);
  assert.ok(old.methodCompatibility.reportedRepair.endpoints.includes("https://api.satledger.org/x402/receipt"));
  assert.equal(old.paymentSent, false);
});

test("a later process with a different client gets a fresh decision", async () => {
  const fetchInput = requestFor({
    methodBinding: binding({
      bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: true, originAgreement: true, headerOnly: false },
      client: { profile: "fetch", retry: "prepared_request" },
    }),
  });
  const httpInput = requestFor({
    callerId: "method-visitor-2",
    methodBinding: binding({
      bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: true, originAgreement: true, headerOnly: false },
      client: { profile: "node-http", retry: "prepared_request" },
    }),
  });
  const first = await executeCallerRequest(fetchInput);
  const later = await resolveLater(first.artifact, httpInput);
  assert.equal(first.receipt.methodCompatibility.decision, "mismatch");
  assert.equal(later.receipt.methodCompatibility.decision, "compatible");
  assert.equal(later.receipt.methodCompatibility.reason, "origin_body_agreement");
  assert.equal(later.predicateApplies, false);
  assert.equal(later.receipt.methodCompatibility.safeToPay, false);
  assert.equal(later.receipt.methodCompatibility.bindingDigest === first.receipt.methodCompatibility.bindingDigest, false);
});

test("cold 0.4.0 answers a different supplied request and rejects a seeded claim", { timeout: 60_000 }, async () => {
  const packed = spawnSync(node, [join(exp, "bin", "pack-consumer-040.mjs")], { cwd: repo, encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const provenance = JSON.parse(await readFile(join(exp, "candidate", "provenance-0.4.0.json"), "utf8"));
  assert.equal(provenance.version, "0.4.0");
  assert.equal(provenance.productionHosted, false);
  const hashes = {
    "seller-repair-external-consumer-0.1.0.tar.gz": "3f3552e9cdedff9910211b1820b229daa834cf3811fcc5b38035046cefda4a27",
    "seller-repair-external-consumer-0.2.0.tar.gz": "86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f",
    "seller-repair-external-consumer-0.3.0.tar.gz": "9a3ff801104d95513ded6791f476a13042453ed9702635a117ebaac9afd73f2e",
  };
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = await readFile(join(exp, "candidate", name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
  }
  const manifest = await readFile(join(repo, "public-acquisition/manifest.json"), "utf8");
  assert.equal(manifest.includes("0.4.0"), false);
  const patch = await readFile(join(exp, "candidate", "ROOT-PUBLIC-ACQUISITION-0.4.0.patch"), "utf8");
  assert.match(patch, new RegExp(provenance.sha256));
  const listed = spawnSync("tar", ["-tzf", join(exp, "candidate", "seller-repair-external-consumer-0.4.0.tar.gz")], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(listed.stdout.includes("method-binding.mjs"), true);
  assert.equal(listed.stdout.includes("node_modules") || listed.stdout.includes("@x402"), false);
  const outside = await mkdtemp(join(tmpdir(), "method-compat-cold-"));
  try {
    const extracted = spawnSync("tar", ["-xzf", join(exp, "candidate", "seller-repair-external-consumer-0.4.0.tar.gz"), "-C", outside], { encoding: "utf8" });
    assert.equal(extracted.status, 0, extracted.stderr);
    const blocked = spawnSync("/exec-daemon/node", [join(outside, "package/bin/caller-deliver.mjs"), "deliver"], {
      cwd: outside,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" },
    });
    assert.equal(blocked.status, 2, blocked.stderr);
    assert.match(blocked.stderr, /node_pin_unsatisfied/);
    const negative = requestFor({
      callerId: "cold-other",
      origin: "https://other.example",
      operation: "GET /v1/other",
      expect: { path: "status", value: "ready" },
      observed: { status: 200, contentType: "application/json", json: { other: "absent" } },
      methodBinding: binding({
        discoveringMethod: null,
        intendedInvocationMethod: null,
        declaredMethods: null,
        acceptedMethods: null,
        bodyShape: { bodyType: "json", hasBody: true, invokeWithBody: null, originAgreement: null, headerOnly: false },
      }),
    });
    const requestPath = join(outside, "request.json");
    await writeFile(requestPath, `${JSON.stringify(negative)}\n`);
    const cold = spawnSync(node, [join(outside, "package/bin/caller-deliver.mjs"), "deliver", "--request", requestPath], {
      cwd: outside,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" },
    });
    assert.equal(cold.status, 0, cold.stderr || cold.stdout);
    const body = JSON.parse(cold.stdout);
    assert.equal(body.methodCompatibility.decision, "unknown");
    assert.equal(body.methodCompatibility.reason, "insufficient_input");
    assert.equal(body.methodCompatibility.inferredMethod, null);
    assert.equal(body.classification.useful, false);
    assert.equal(body.methodCompatibility.safeToPay, false);
    assert.equal(body.paymentSent, false);
    assert.equal(body.methodCompatibility.independentlyExecuted, false);
    const seededPath = join(outside, "seeded.json");
    await writeFile(seededPath, `${JSON.stringify({ ...negative, safeToPay: true })}\n`);
    const seeded = spawnSync(node, [join(outside, "package/bin/caller-deliver.mjs"), "deliver", "--request", seededPath], {
      cwd: outside,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" },
    });
    assert.equal(seeded.status, 2, seeded.stdout || seeded.stderr);
    assert.equal(JSON.parse(seeded.stdout).executed, false);
    assert.equal(JSON.parse(seeded.stdout).safeToPay, false);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
