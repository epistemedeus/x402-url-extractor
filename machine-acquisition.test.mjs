import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ACQUISITION_SKILL_NAME,
  DECLARED_EXTRACT_OPERATION,
  DEFAULT_MERCHANT_RECIPIENT,
  NEO_INDEX_URL,
  NEO_SKILL_URL,
  acquisitionIndexSkill,
  authorizeReceiptAction,
  bindingFromCapture,
  classifyInstallEvidence,
  extractChallengePayTo,
  handleMachineAcquisitionRequest,
  installFromWellKnown,
  loadMachineAcquisition,
  nodeEngineSatisfies,
} from "./machine-acquisition.mjs";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(REPO_ROOT, "machine-acquisition", "bundles", ACQUISITION_SKILL_NAME);
const NODE = process.execPath;

function response() {
  const headers = {};
  let status = 200;
  let body = "";
  return {
    statusCode() { return status; },
    headers() { return headers; },
    body() { return body; },
    status(code) { status = code; return this; },
    set(name, value) {
      if (name && typeof name === "object") {
        for (const [key, val] of Object.entries(name)) headers[key.toLowerCase()] = String(val);
        return this;
      }
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    end(chunk) {
      if (chunk !== undefined) body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      return this;
    },
    send(chunk) {
      body = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      return this;
    },
  };
}

function currentReceipt(overrides = {}) {
  return {
    schema: "neomorphic.route-release-decision.receipt.v1",
    ok: true,
    mutation: "none",
    evaluatedAt: "2026-10-01T11:00:00.000Z",
    evaluatedAtState: "known",
    observedAt: "2026-10-01T11:00:00.000Z",
    observedAtState: "known",
    offer: { expiresAt: "2099-01-01T00:00:00.000Z", expiry: "known", fresh: true },
    route: { decision: "lockable", code: "six_dimension_settlement_ready" },
    operation: {
      method: "GET",
      origin: "https://agents.samedaydesk.com",
      route: "/extract",
      publicRoute: "GET https://agents.samedaydesk.com/extract",
      bindingDigest: "sha256:test",
    },
    currentAuthority: { granted: false, paymentPermitted: false },
    ...overrides,
  };
}

const BINDING = {
  method: "GET",
  origin: "https://agents.samedaydesk.com",
  route: "/extract",
  recipient: DEFAULT_MERCHANT_RECIPIENT,
};

test("pinned public bytes keep the Neo URL, license, and declared extract operation", () => {
  const bundle = loadMachineAcquisition();
  assert.equal(bundle.name, ACQUISITION_SKILL_NAME);
  assert.equal(bundle.order.length, 14);
  assert.equal(bundle.files.has("scripts/lock-and-capture.mjs"), true);
  assert.deepEqual(bundle.declaredOperation, DECLARED_EXTRACT_OPERATION);
  const manifest = JSON.parse(bundle.files.get("references/manifest.json").toString("utf8"));
  assert.equal(manifest.indexUrl, NEO_INDEX_URL);
  assert.equal(manifest.deploymentUrl, NEO_SKILL_URL);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.hostedAcquisitionVerified, false);
  const notice = readFileSync(join(REPO_ROOT, "machine-acquisition", "SOURCE-NOTICE.txt"), "utf8");
  assert.match(notice, /79a18338251769f22ca31a951008fca62dc70797/);
  assert.match(notice, /MIT/);
  assert.match(notice, /GET https:\/\/agents\.samedaydesk\.com\/extract/);
  const entry = acquisitionIndexSkill({ bundle });
  assert.equal(entry.files.length, 14);
  assert.equal(entry.source.operation.recipient, DEFAULT_MERCHANT_RECIPIENT);
  assert.equal(entry.source.originUrl, NEO_SKILL_URL);
  assert.equal(nodeEngineSatisfies("22.22.2", bundle.pins.enginesNode), true);
  assert.equal(nodeEngineSatisfies("22.14.0", bundle.pins.enginesNode), false);
});

test("allowlisted static paths serve exact bytes and reject traversal", () => {
  const bundle = loadMachineAcquisition();
  const ok = response();
  handleMachineAcquisitionRequest(
    { method: "GET", path: "/.well-known/skills/route-lock-receipt/scripts/lock-and-capture.mjs", originalUrl: "/.well-known/skills/route-lock-receipt/scripts/lock-and-capture.mjs" },
    ok,
    { bundle, publicUrl: "https://agents.samedaydesk.com" },
  );
  assert.equal(ok.statusCode(), 200);
  assert.equal(ok.headers()["content-type"], "text/javascript; charset=utf-8");
  assert.equal(ok.body(), bundle.files.get("scripts/lock-and-capture.mjs").toString("utf8"));
  assert.match(ok.headers().link, /agents\.samedaydesk\.com\/\.well-known\/skills\/route-lock-receipt\/scripts\/lock-and-capture\.mjs/);
  const blocked = [
    "/.well-known/skills/route-lock-receipt/../../server.js",
    "/.well-known/skills/route-lock-receipt/%2e%2e/server.js",
    "/.well-known/skills/route-lock-receipt/scripts/missing.mjs",
    "/.well-known/skills/route-lock-receipt/",
  ];
  for (const path of blocked) {
    const res = response();
    handleMachineAcquisitionRequest({ method: "GET", path, originalUrl: path }, res, { bundle });
    assert.equal(res.statusCode(), 404, path);
    assert.equal(res.body().includes("PAY_TO"), false);
    assert.equal(res.body().includes("secret"), false);
  }
  const other = response();
  const handled = handleMachineAcquisitionRequest(
    { method: "GET", path: "/.well-known/skills/web-extract/SKILL.md", originalUrl: "/.well-known/skills/web-extract/SKILL.md" },
    other,
    { bundle },
  );
  assert.equal(handled, false);
  const encodedOther = handleMachineAcquisitionRequest(
    { method: "GET", path: "/.well-known/skills/web%2dextract/SKILL.md", originalUrl: "/.well-known/skills/web%2dextract/SKILL.md" },
    response(),
    { bundle },
  );
  assert.equal(encodedOther, false);
  const queryEncoded = handleMachineAcquisitionRequest(
    { method: "GET", path: "/extract", originalUrl: "/extract?url=https%3A%2F%2Fexample.com" },
    response(),
    { bundle },
  );
  assert.equal(queryEncoded, false);
  const head = response();
  handleMachineAcquisitionRequest(
    { method: "HEAD", path: "/.well-known/skills/route-lock-receipt/SKILL.md", originalUrl: "/.well-known/skills/route-lock-receipt/SKILL.md" },
    head,
    { bundle },
  );
  assert.equal(head.statusCode(), 200);
  assert.equal(head.body(), "");
  assert.equal(head.headers()["content-length"], String(bundle.files.get("SKILL.md").length));
});

test("changed bundle bytes fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "machine-acquisition-tamper-"));
  const bundleDir = join(root, "bundle");
  cpSync(BUNDLE, bundleDir, { recursive: true });
  const pins = JSON.parse(readFileSync(join(REPO_ROOT, "machine-acquisition", "pins.json"), "utf8"));
  const target = join(bundleDir, "SKILL.md");
  writeFileSync(target, `${readFileSync(target, "utf8")}\nchanged\n`);
  assert.throws(() => loadMachineAcquisition(bundleDir, join(REPO_ROOT, "machine-acquisition", "pins.json")), /changed content/);
  writeFileSync(join(root, "pins.json"), JSON.stringify(pins));
  rmSync(join(bundleDir, "scripts", "time.mjs"));
  assert.throws(() => loadMachineAcquisition(bundleDir, join(root, "pins.json")), /bundle file set/);
});

test("node-fetch installer is not a native Hermes install and rejects seeded failures", async () => {
  const bundle = loadMachineAcquisition();
  const pins = Object.fromEntries(bundle.order.map((rel) => [rel, createHash("sha256").update(bundle.files.get(rel)).digest("hex")]));
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    const url = new URL(req.url, "http://127.0.0.1");
    const index = "/.well-known/skills/index.json";
    if (url.pathname === `/redirect${index}`) {
      res.writeHead(302, { Location: "/elsewhere" });
      res.end();
      return;
    }
    if (url.pathname === `/malformed${index}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{");
      return;
    }
    if (url.pathname === `/missing${index}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skills: [{ name: ACQUISITION_SKILL_NAME, files: ["SKILL.md", "scripts/lock-and-capture.mjs"] }] }));
      return;
    }
    if (url.pathname === `/missing/.well-known/skills/${ACQUISITION_SKILL_NAME}/SKILL.md`) {
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end(bundle.files.get("SKILL.md"));
      return;
    }
    if (url.pathname === `/unsafe${index}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skills: [{ name: ACQUISITION_SKILL_NAME, files: ["SKILL.md", "../outside.txt"] }] }));
      return;
    }
    if (url.pathname === `/changed${index}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skills: [{ name: ACQUISITION_SKILL_NAME, files: ["SKILL.md"] }] }));
      return;
    }
    if (url.pathname === `/changed/.well-known/skills/${ACQUISITION_SKILL_NAME}/SKILL.md`) {
      res.writeHead(200, { "Content-Type": "text/markdown" });
      res.end("changed skill bytes");
      return;
    }
    if (url.pathname === `/good${index}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ skills: [{ name: ACQUISITION_SKILL_NAME, description: bundle.description, files: bundle.order }] }));
      return;
    }
    const marker = `/good/.well-known/skills/${ACQUISITION_SKILL_NAME}/`;
    const rel = url.pathname.startsWith(marker) ? decodeURIComponent(url.pathname.slice(marker.length)) : "";
    if (rel && bundle.files.has(rel)) {
      res.writeHead(200);
      res.end(bundle.files.get(rel));
      return;
    }
    res.writeHead(404);
    res.end("no");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const parent = mkdtempSync(join(tmpdir(), "machine-acquisition-install-"));
    const indexPath = "/.well-known/skills/index.json";
    const redirect = await installFromWellKnown({ indexUrl: `${base}/redirect${indexPath}`, dest: join(parent, "redirect") });
    assert.equal(redirect.ok, false);
    assert.equal(redirect.code, "redirect_rejected");
    assert.equal(redirect.nativeHermesInstall, false);
    const malformed = await installFromWellKnown({ indexUrl: `${base}/malformed${indexPath}`, dest: join(parent, "malformed") });
    assert.equal(malformed.code, "malformed_index");
    const missing = await installFromWellKnown({ indexUrl: `${base}/missing${indexPath}`, dest: join(parent, "missing") });
    assert.equal(missing.code, "missing_support_file");
    const unsafe = await installFromWellKnown({ indexUrl: `${base}/unsafe${indexPath}`, dest: join(parent, "unsafe") });
    assert.equal(unsafe.code, "unsafe_path");
    assert.equal(hits.some((hit) => hit.includes("outside.txt")), false);
    const changed = await installFromWellKnown({
      indexUrl: `${base}/changed${indexPath}`,
      dest: join(parent, "changed"),
      pins: { "SKILL.md": pins["SKILL.md"] },
    });
    assert.equal(changed.code, "changed_content");
    const good = await installFromWellKnown({
      indexUrl: `${base}/good${indexPath}`,
      dest: join(parent, "good"),
      pins,
    });
    assert.equal(good.ok, true);
    assert.equal(good.nativeHermesInstall, false);
    assert.equal(good.client, "node-fetch-manual-redirect");
    const installedSkill = readFileSync(join(parent, "good", "SKILL.md"));
    const installedExec = readFileSync(join(parent, "good", "scripts", "lock-and-capture.mjs"));
    assert.equal(createHash("sha256").update(installedSkill).digest("hex"), pins["SKILL.md"]);
    assert.equal(createHash("sha256").update(installedExec).digest("hex"), pins["scripts/lock-and-capture.mjs"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a non-Hermes client cannot be recorded as a native install", () => {
  const rejected = classifyInstallEvidence({
    nativeHermesInstall: true,
    client: "node-https",
    skillMdOnDisk: true,
    executableOnDisk: true,
    headerSpoof: false,
  });
  assert.equal(rejected.accepted, false);
  assert.equal(rejected.reason, "non_hermes_client_called_native");
  const spoof = classifyInstallEvidence({ nativeHermesInstall: true, client: "hermes-cli", headerSpoof: true, skillMdOnDisk: true });
  assert.equal(spoof.reason, "spoofed_header_called_native");
  const absent = classifyInstallEvidence({ nativeRuntimeAvailable: false });
  assert.equal(absent.abstain, true);
  assert.equal(absent.reason, "native_runtime_unavailable");
});

test("expired, changed-origin, method, route, and recipient receipts do not authorize an action", async () => {
  const { readReceipt } = await import(new URL("./machine-acquisition/bundles/route-lock-receipt/scripts/receipt.mjs", import.meta.url));
  const now = "2026-10-01T12:00:00.000Z";
  const accepted = authorizeReceiptAction(currentReceipt(), BINDING, { now, readReceipt });
  assert.equal(accepted.exitCode, 0);
  assert.equal(accepted.observationAccepted, true);
  assert.equal(accepted.actionAuthorized, false);
  assert.equal(accepted.newAuthority, "denied");
  assert.equal(accepted.executed, false);
  const cases = [
    [currentReceipt({ offer: { expiresAt: "2020-01-01T00:00:00.000Z", expiry: "known", fresh: true } }), "expired"],
    [currentReceipt({ operation: { ...currentReceipt().operation, origin: "https://evil.example" } }), "changed-origin"],
    [currentReceipt({ operation: { ...currentReceipt().operation, method: "POST" } }), "changed-method"],
    [currentReceipt({ operation: { ...currentReceipt().operation, route: "/extract/batch" } }), "changed-route"],
    [currentReceipt({ mutation: "changed-recipient" }), "changed-recipient"],
  ];
  for (const [receipt, reason] of cases) {
    const decision = authorizeReceiptAction(receipt, BINDING, { now, readReceipt });
    assert.equal(decision.reason, reason, reason);
    assert.equal(decision.actionAuthorized, false);
    assert.equal(decision.newAuthority, "denied");
    assert.equal(decision.exitCode, 3);
    assert.equal(decision.executed, false);
  }
  const flipped = authorizeReceiptAction(currentReceipt(), BINDING, {
    now,
    readReceipt,
    observedRecipient: `0x${"ab".repeat(20)}`,
  });
  assert.equal(flipped.reason, "changed-recipient");
  assert.equal(bindingFromCapture({
    receipt: currentReceipt(),
    payTo: DEFAULT_MERCHANT_RECIPIENT,
  }).route, "/extract");
  assert.throws(() => bindingFromCapture({
    receipt: currentReceipt({ operation: { ...currentReceipt().operation, route: "/other" } }),
    payTo: DEFAULT_MERCHANT_RECIPIENT,
  }), /route/);
  assert.equal(extractChallengePayTo({
    subject: {
      runtime: {
        headers: {
          "payment-required": Buffer.from(JSON.stringify({
            accepts: [{ payTo: DEFAULT_MERCHANT_RECIPIENT }],
          })).toString("base64"),
        },
      },
    },
  }), DEFAULT_MERCHANT_RECIPIENT);
});

test("the installed continue executable rejects an expired receipt and does not authorize", () => {
  const home = mkdtempSync(join(tmpdir(), "machine-acquisition-continue-"));
  const receiptPath = join(home, "receipt.json");
  const outPath = join(home, "continuation.json");
  writeFileSync(receiptPath, JSON.stringify(currentReceipt({
    offer: { expiresAt: "2020-01-01T00:00:00.000Z", expiry: "known", fresh: true },
  })));
  const child = spawnSync(NODE, [
    join(BUNDLE, "scripts", "lock-and-capture.mjs"),
    "continue",
    "--receipt",
    receiptPath,
    "--out",
    outPath,
  ], { encoding: "utf8" });
  assert.equal(child.status, 3, child.stderr);
  const body = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(body.reason, "expired");
  assert.equal(body.newAuthority, "denied");
  assert.equal(body.paymentPermitted, false);
  assert.equal(body.executed, false);
  assert.equal(body.ownerPayment, false);
  mkdirSync(join(home, "ok"), { recursive: true });
});
