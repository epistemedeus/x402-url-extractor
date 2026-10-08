import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { collectExpressBindings, routeBindingProblems } from "../route-binding-inspect.mjs";
import { CURRENT_PATH, CURRENT_SCHEMA, GRANT_READ_PATH } from "../useful-result-reuse/constants.mjs";
import { mountUsefulResultReuse } from "../useful-result-reuse/http.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "tools/verify/cli.mjs");
const REUSE_TOKEN = "useful-result-reuse-grant-token-32b-minimum-value";

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
  });
  let json = null;
  if (result.stdout) {
    try {
      json = JSON.parse(result.stdout);
    } catch {
      json = null;
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test("unknown flag exits 2 before any check", () => {
  const result = run(["discover", "--not-a-flag", "--json"]);
  assert.equal(result.status, 2);
  assert.equal(result.json?.error?.code, "bad-invocation");
  assert.equal(result.json?.boundary?.paymentSent, false);
  assert.equal(result.json?.evidence?.length, 0);
});

test("self-test passes and the harness control is a real mismatch", () => {
  const result = run(["self-test", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.schemaVersion, 1);
  assert.equal(result.json.boundary.settled, false);
  assert.equal(result.json.boundary.paymentSent, false);
  const control = result.json.evidence.find((item) => item.id === "harness-control");
  assert.equal(control.observed, false);
  assert.equal(control.expected, false);
  assert.equal(control.assertionPassed, true);
  for (const id of ["fixture-amount-5001", "fixture-payto-short", "fixture-manifest-openapi-drift", "fixture-railway-canonical", "fixture-healthz-missing-batch"]) {
    const item = result.json.evidence.find((entry) => entry.id === id);
    assert.equal(item.assertionPassed, true, id);
    assert.equal(item.observed, true, id);
  }
  for (const id of ["fixture-bazaar-sample-differs", "fixture-a2a-redirect", "fixture-zero-charge-write", "fixture-range-vs-fixed", "fixture-stripe-human"]) {
    const item = result.json.evidence.find((entry) => entry.id === id);
    assert.equal(item.assertionPassed, true, id);
    assert.equal(item.observed, false, id);
  }
});

test("seeded amount 5001 and a one-character payTo exit 1", () => {
  const amount = run(["catalog", "check", "--profile", "local", "--fixture", "amount-5001", "--json"]);
  assert.equal(amount.status, 1);
  assert.equal(amount.json.ok, false);
  assert.equal(amount.json.evidence[0].observed, "5001");
  assert.equal(amount.json.evidence[0].assertionPassed, false);
  const payTo = run(["catalog", "check", "--profile", "local", "--fixture", "payto-short", "--json"]);
  assert.equal(payTo.status, 1);
  assert.equal(payTo.json.evidence[0].observed, false);
});

test("manifest 5000 versus OpenAPI 0.01 exits 1 and 10000 versus 0.01 passes", () => {
  const drift = run(["catalog", "check", "--profile", "local", "--fixture", "manifest-openapi-drift", "--json"]);
  assert.equal(drift.status, 1);
  assert.equal(drift.json.evidence[0].observed, false);
  const ok = run(["catalog", "check", "--profile", "local", "--fixture", "price-surface-ok", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.evidence[0].observed, true);
});

test("Railway host as canonical exits 1 and a truthful alias does not", () => {
  const railway = run(["catalog", "check", "--profile", "local", "--fixture", "railway-canonical", "--json"]);
  assert.equal(railway.status, 1);
  assert.match(String(railway.json.evidence[0].observed), /up\.railway\.app/);
  const alias = run(["catalog", "check", "--profile", "local", "--fixture", "railway-alias", "--json"]);
  assert.equal(alias.status, 0, alias.stderr);
  assert.equal(alias.json.evidence[0].observed.defect, false);
});

test("missing healthz extract/batch exits 1 and atomic 10000 passes", () => {
  const missing = run(["catalog", "check", "--profile", "local", "--fixture", "healthz-missing-batch", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.evidence[0].observed, null);
  const present = run(["catalog", "check", "--profile", "local", "--fixture", "healthz-batch-ok", "--json"]);
  assert.equal(present.status, 0, present.stderr);
  assert.equal(present.json.evidence[0].observed, "10000");
});

test("settle request exits 1 without setting settled", () => {
  const result = run(["catalog", "check", "--profile", "local", "--fixture", "settle-requested", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(result.json.boundary.settled, false);
  assert.equal(result.json.boundary.paymentSent, false);
  assert.equal(result.json.evidence[0].observed, "settlement-requested");
});

test("operation identity agrees across surfaces and rejects batch-per-success and lockfile-on-mpp", () => {
  const ok = run(["catalog", "check", "--profile", "local", "--fixture", "operation-identity-ok", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.evidence[0].observed.consistent, true);
  assert.deepEqual(ok.json.evidence[0].observed.ids, ["extract", "extract_batch", "lockfile-pin-delta"]);
  const batch = run(["catalog", "check", "--profile", "local", "--fixture", "batch-per-successful-call", "--json"]);
  assert.equal(batch.status, 1);
  assert.equal(batch.json.evidence[0].observed.consistent, false);
  assert.ok(batch.json.evidence[0].observed.problems.some((problem) => problem.includes("batch-per-successful-call")));
  const lockfile = run(["catalog", "check", "--profile", "local", "--fixture", "lockfile-on-mpp", "--json"]);
  assert.equal(lockfile.status, 1);
  assert.ok(lockfile.json.evidence[0].observed.problems.some((problem) => problem.includes("lockfile-not-x402-only")));
  assert.equal(lockfile.json.boundary.settled, false);
});

test("counterexample fixtures pass", () => {
  for (const name of ["bazaar-sample-differs", "a2a-redirect", "zero-charge-write", "range-vs-fixed", "stripe-human"]) {
    const result = run(["journey", "catalog", "--profile", "local", "--fixture", name, "--json"]);
    assert.equal(result.status, 0, `${name} ${result.stderr}`);
    assert.equal(result.json.evidence[0].observed.defect, false, name);
    assert.equal(result.json.boundary.settled, false);
  }
});

function reuseOpenApi() {
  return {
    paths: {
      [CURRENT_PATH]: {
        get: { operationId: "getUsefulResultReuseCurrent", responses: { "200": { description: "current" } } },
      },
      [GRANT_READ_PATH]: {
        get: { operationId: "readRetainedUsefulResult", responses: { "200": { description: "read" } } },
        post: { operationId: "mutateRetainedUsefulResult", responses: { "200": { description: "mutate" } } },
      },
    },
  };
}

function handlerCount(bindings, routePath, method) {
  return bindings.find((entry) => entry.path === routePath)?.methods?.[method]?.handlerCount || 0;
}

async function listenReuse(dataDir, options = {}) {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  const mounted = mountUsefulResultReuse(app, { dataDir, internalToken: REUSE_TOKEN, ...options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    app,
    mounted,
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test("useful-result reuse registration is inspected on a cold mount and still rejects gaps", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "reuse-route-bind-"));
  const seen = [];
  const first = await listenReuse(dataDir, {
    freeTaskObservation: () => (req, res) => {
      if (req.method === "POST" && req.path === CURRENT_PATH && req.get("x-samedaydesk-result-action") === "start-attempt-capture") {
        seen.push("post-current");
        res.status(200).json({ ok: true, paymentPermitted: false });
        return true;
      }
      return false;
    },
  });
  try {
    const bindings = collectExpressBindings(first.app);
    assert.ok(handlerCount(bindings, CURRENT_PATH, "GET") >= 1);
    assert.ok(handlerCount(bindings, GRANT_READ_PATH, "GET") >= 1);
    assert.ok(handlerCount(bindings, GRANT_READ_PATH, "POST") >= 1);
    assert.equal(
      bindings.find((entry) => entry.path === GRANT_READ_PATH)?.methods?.POST?.handlerNames?.includes("dispatchUsefulResultReuse"),
      true,
    );
    const published = routeBindingProblems({
      bindings,
      catalog: { actions: [], freeRecipes: [] },
      openapi: reuseOpenApi(),
      mcpTools: [],
    });
    assert.deepEqual(published.filter((problem) => problem.includes("useful-result-reuse")), []);

    const openapi = reuseOpenApi();
    openapi.paths["/.well-known/useful-result-reuse/absent"] = {
      get: { responses: { "200": { description: "not registered" } } },
    };
    openapi.paths[CURRENT_PATH].post = { responses: { "200": { description: "not a published method" } } };
    const rejected = routeBindingProblems({
      bindings,
      catalog: { actions: [], freeRecipes: [] },
      openapi,
      mcpTools: [],
    });
    assert.ok(rejected.includes("missing-handler GET /.well-known/useful-result-reuse/absent"));
    assert.ok(rejected.includes(`method-mismatch ${CURRENT_PATH} openapi POST express GET`));

    const aliasApp = express();
    const aliasRouter = express.Router();
    aliasRouter.get(["/leaf", "/leaf-alias"], function aliasLeaf(_req, res) { res.end("ok"); });
    aliasApp.use("/.well-known/alias-prefix", aliasRouter);
    aliasApp.get(["/direct-alias", "/direct-alias-b"], function directAlias(_req, res) { res.end("ok"); });
    const aliasBindings = collectExpressBindings(aliasApp);
    assert.equal(handlerCount(aliasBindings, "/.well-known/alias-prefix/leaf", "GET") >= 1, true);
    assert.equal(handlerCount(aliasBindings, "/.well-known/alias-prefix/leaf-alias", "GET") >= 1, true);
    assert.equal(handlerCount(aliasBindings, "/direct-alias", "GET") >= 1, true);
    assert.equal(handlerCount(aliasBindings, "/direct-alias-b", "GET") >= 1, true);
    const aliasProblems = routeBindingProblems({
      bindings: aliasBindings,
      catalog: { actions: [], freeRecipes: [] },
      openapi: { paths: { "/.well-known/alias-prefix/missing": { post: { responses: { "200": { description: "absent" } } } } } },
      mcpTools: [],
    });
    assert.ok(aliasProblems.includes("missing-handler POST /.well-known/alias-prefix/missing"));

    const current = await fetch(`${first.base}${CURRENT_PATH}`);
    const currentBody = await current.json();
    assert.equal(current.status, 200);
    assert.equal(currentBody.schema, CURRENT_SCHEMA);
    assert.equal(currentBody.customerRetention.read.route, GRANT_READ_PATH);
    assert.equal(current.headers.get("payment-required"), null);
    const head = await fetch(`${first.base}${CURRENT_PATH}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const retained = await fetch(`${first.base}${GRANT_READ_PATH}`);
    assert.equal(retained.status, 401);
    assert.equal((await retained.json()).error, "grant_required");
    assert.equal(retained.headers.get("payment-required"), null);
    const wrongMethod = await fetch(`${first.base}${GRANT_READ_PATH}`, { method: "PUT" });
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error, "method_rejected");
    const wrongCurrent = await fetch(`${first.base}${CURRENT_PATH}`, { method: "DELETE" });
    assert.equal(wrongCurrent.status, 405);
    assert.equal((await wrongCurrent.json()).error, "method_rejected");
    const observed = await fetch(`${first.base}${CURRENT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-samedaydesk-result-action": "start-attempt-capture" },
      body: "{}",
    });
    assert.equal(observed.status, 200);
    assert.equal((await observed.json()).paymentPermitted, false);
    assert.deepEqual(seen, ["post-current"]);
    const absent = await fetch(`${first.base}/.well-known/useful-result-reuse/absent`);
    assert.equal(absent.status, 404);
  } finally {
    await first.close();
    await rm(dataDir, { recursive: true, force: true });
  }

  const againDir = await mkdtemp(path.join(tmpdir(), "reuse-route-bind-cold-"));
  const again = await listenReuse(againDir);
  try {
    const bindings = collectExpressBindings(again.app);
    assert.ok(handlerCount(bindings, CURRENT_PATH, "GET") >= 1);
    assert.ok(handlerCount(bindings, GRANT_READ_PATH, "GET") >= 1);
    assert.ok(handlerCount(bindings, GRANT_READ_PATH, "POST") >= 1);
    const current = await fetch(`${again.base}${CURRENT_PATH}`);
    assert.equal(current.status, 200);
    assert.equal((await current.json()).schema, CURRENT_SCHEMA);
    assert.equal(current.headers.get("payment-required"), null);
  } finally {
    await again.close();
    await rm(againDir, { recursive: true, force: true });
  }
});

test("route binding accepts a matched handler and rejects a method mismatch or missing handler", () => {
  const ok = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-ok", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.evidence[0].observed.consistent, true);
  const mismatch = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-method-mismatch", "--json"]);
  assert.equal(mismatch.status, 1);
  assert.equal(mismatch.json.ok, false);
  assert.equal(mismatch.json.boundary.paymentSent, false);
  assert.equal(mismatch.json.boundary.settled, false);
  assert.ok(mismatch.json.evidence[0].observed.problems.some((problem) => problem.startsWith("method-mismatch")));
  const missing = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-missing-handler", "--json"]);
  assert.equal(missing.status, 1);
  assert.ok(missing.json.evidence[0].observed.problems.some((problem) => problem.startsWith("missing-handler")));
});

test("proxy-backed paidHttp tools pass without run and malformed bindings fail", () => {
  for (const name of ["route-binding-proxy-extract-batch", "route-binding-proxy-lockfile-pin-delta"]) {
    const ok = run(["routes", "inspect", "--profile", "local", "--fixture", name, "--json"]);
    assert.equal(ok.status, 0, `${name} ${ok.stderr}`);
    assert.equal(ok.json.evidence[0].observed.consistent, true, name);
    assert.deepEqual(ok.json.evidence[0].observed.problems, []);
    assert.equal(ok.json.boundary.paymentSent, false);
    assert.equal(ok.json.boundary.settled, false);
  }
  const absent = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-proxy-paidhttp-absent", "--json"]);
  assert.equal(absent.status, 1);
  assert.equal(absent.json.boundary.paymentSent, false);
  assert.equal(absent.json.boundary.settled, false);
  assert.ok(absent.json.evidence[0].observed.problems.includes("missing-handler MCP extract_batch"));
  const wrongMethod = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-proxy-paidhttp-wrong-method", "--json"]);
  assert.equal(wrongMethod.status, 1);
  assert.ok(wrongMethod.json.evidence[0].observed.problems.includes("method-mismatch /extract/batch catalog POST mcp GET"));
  const wrongPath = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-proxy-paidhttp-wrong-path", "--json"]);
  assert.equal(wrongPath.status, 1);
  assert.ok(wrongPath.json.evidence[0].observed.problems.includes("method-mismatch /extract/batch catalog /extract/batch mcp /extract"));
  const malformed = run(["routes", "inspect", "--profile", "local", "--fixture", "route-binding-proxy-paidhttp-malformed", "--json"]);
  assert.equal(malformed.status, 1);
  assert.ok(malformed.json.evidence[0].observed.problems.includes("malformed-paid-http MCP extract_batch"));
});

test("page-change listing accepts a free unpaid snapshot and rejects a settlement demand", () => {
  const ok = run(["page-change", "check", "--profile", "local", "--fixture", "page-change-listing-ok", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.evidence[0].observed.settlementDemanded, false);
  assert.equal(ok.json.evidence[0].observed.charged, false);
  const demanded = run(["page-change", "check", "--profile", "local", "--fixture", "page-change-settlement-demanded", "--json"]);
  assert.equal(demanded.status, 1);
  assert.equal(demanded.json.ok, false);
  assert.equal(demanded.json.boundary.settled, false);
  assert.equal(demanded.json.evidence[0].observed.settlementDemanded, true);
  assert.ok(demanded.json.evidence[0].observed.problems.some((problem) => problem.startsWith("settlement-demanded")));
});

test("non-success page-change statuses stay unpaid and fail coherence", () => {
  for (const status of [404, 405, 500, 503]) {
    const result = run(["page-change", "check", "--profile", "local", "--fixture", `page-change-status-${status}`, "--json"]);
    assert.equal(result.status, 1, String(status));
    assert.equal(result.json.ok, false);
    assert.equal(result.json.boundary.paymentSent, false);
    assert.equal(result.json.boundary.settled, false);
    assert.equal(result.json.evidence[0].observed.consistent, false);
    assert.equal(result.json.evidence[0].observed.settlementDemanded, false);
    assert.equal(result.json.evidence[0].observed.charged, false);
    assert.ok(result.json.evidence[0].observed.problems.includes(`unpaid-status-${status}`));
  }
});

test("page-change MCP session rejects a missing tool and a payment challenge", () => {
  const missing = run(["page-change", "check", "--profile", "local", "--fixture", "page-change-mcp-unlisted", "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.evidence[0].observed.settlementDemanded, false);
  assert.equal(missing.json.boundary.settled, false);
  assert.ok(missing.json.evidence[0].observed.problems.includes("mcp-free-tool-missing"));
  const challenge = run(["page-change", "check", "--profile", "local", "--fixture", "page-change-mcp-payment-challenge", "--json"]);
  assert.equal(challenge.status, 1);
  assert.equal(challenge.json.boundary.paymentSent, false);
  assert.equal(challenge.json.boundary.settled, false);
  assert.equal(challenge.json.evidence[0].observed.settlementDemanded, true);
  assert.ok(challenge.json.evidence[0].observed.problems.includes("settlement-demanded-mcp"));
  assert.ok(challenge.json.evidence[0].observed.problems.includes("mcp-call-failed"));
});

test("merchant-verify is on the default npm test path", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const files = pkg.scripts.test.replace(/^node --test\s+/, "").split(/\s+/).filter(Boolean);
  assert.equal(files.filter((file) => file === "test/merchant-verify.test.mjs").length, 1);
});

test("archive profile passes the canonical unpaid snapshot", () => {
  const result = run(["journey", "challenge", "--profile", "archive", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.evidence.every((item) => item.assertionPassed), true);
});
