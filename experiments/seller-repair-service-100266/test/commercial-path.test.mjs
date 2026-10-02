import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyCommerceRoute } from "../../../commerce-events.mjs";
import {
  buyerPath,
  invitationPacket,
  isFixedCatalogExample,
  rejectCommercialSeed,
  runCommercialDeliver,
} from "../commercial/deliver.mjs";

const repo = join(import.meta.dirname, "..", "..", "..");
const exp = join(repo, "experiments", "seller-repair-service-100266");
const node = process.execPath;
const blocked = ["COMMERCE_DATA_DIR", "COMMERCE_INTERNAL_TOKEN", "USEFUL_RESULT_GRANT", "SELLER_REPAIR_PRIVATE"];

function run(args, env = {}) {
  return spawnSync(node, args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("free diagnosis is an exact unmatched commerce route and the audit stays paid", () => {
  assert.deepEqual(classifyCommerceRoute("/commerce/seller-repair-diagnosis"), {
    route: "/commerce/seller-repair-diagnosis",
    kind: "unmatched",
    matched: true,
  });
  assert.equal(classifyCommerceRoute("/commerce/seller-integrity-audit").kind, "paid");
  assert.equal(classifyCommerceRoute("/commerce/other").route, "/commerce/*");
});

test("a fixed catalog example and a seeded success flag are refused", async () => {
  const catalog = {
    callerId: "catalog",
    origin: "https://seller.example",
    operation: "GET /catalog/item",
    sdk: "node-https@22",
    expect: { path: "sku", value: "WIDGET-1" },
  };
  assert.equal(isFixedCatalogExample(catalog), true);
  const refused = await runCommercialDeliver({ repairCaller: catalog, negativeCaller: catalog });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "fixed_example_is_not_caller_task");
  assert.equal(refused.paymentSent, false);
  const seeded = run([
    join(exp, "bin", "commercial-path.mjs"),
    "reject-seeded",
    join(exp, "fixtures", "commercial-seeded-false.json"),
  ]);
  assert.equal(seeded.status, 2, seeded.stderr);
  const body = JSON.parse(seeded.stdout);
  assert.equal(body.refused, true);
  assert.equal(body.reasons.includes("http200_is_not_useful"), true);
  assert.equal(body.reasons.includes("target_402_is_not_a_defect_or_order"), true);
  assert.equal(body.reasons.includes("submitted_artifact_is_not_trusted"), true);
  assert.equal(body.reasons.includes("causal_identity_is_not_authority"), true);
  assert.equal(body.reasons.includes("savings_not_measured"), true);
  assert.equal(body.recognizedRevenueAtomic, "0");
  assert.equal(rejectCommercialSeed({ http200IsSuccess: true }).refused, true);
});

test("self-test records the disposable fixture, refusals, and a zero-revenue economics receipt", { timeout: 120_000 }, () => {
  const out = spawnSync("mktemp", ["-d"], { encoding: "utf8" });
  const dir = out.stdout.trim();
  const delivered = run([join(exp, "bin", "commercial-path.mjs"), "self-test", "--out", dir]);
  assert.equal(delivered.status, 0, delivered.stdout || delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.mode, "self-test");
  assert.equal(receipt.qa, true);
  assert.equal(receipt.visitorExecution, false);
  assert.equal(receipt.fixtureTransport, true);
  assert.deepEqual(receipt.failed, []);
  assert.equal(receipt.charged, false);
  assert.equal(receipt.paymentSent, false);
  assert.equal(receipt.recognizedRevenueAtomic, "0");
  assert.equal(receipt.refusals.private.probes, 0);
  assert.equal(receipt.refusals.dnsChanged.reason, "dns_changed");
  assert.equal(receipt.refusals.redirect.refused, true);
  assert.equal(receipt.refusals.bodyCeiling.reason, "body_ceiling");
  assert.equal(receipt.refusals.deadline.reason, "body_deadline");
  assert.equal(receipt.economics.demandEstablished, false);
  assert.equal(receipt.economics.causalGrantsUsefulness, false);
  assert.equal(receipt.economics.crossOwnerRevocationTransferred, false);
  assert.equal(receipt.economics.replaySettlementTrusted, false);
  assert.equal(receipt.diagnosis.duplicate, true);
  assert.equal(receipt.artifactTrusted, false);
  assert.equal(delivered.stdout.includes("commercial-path-disposable-token"), false);
  const artifact = JSON.parse(readFileSync(join(dir, "regression.json"), "utf8"));
  assert.equal(artifact.schema, "samedaydesk.seller-repair-regression.v1");
  assert.equal(artifact.mode, "self-test");
  assert.equal(artifact.qa, true);
  assert.equal(artifact.visitorExecution, false);
  assert.equal(artifact.trusted, false);
  assert.equal(artifact.retest.class, "caller_reviewed_retest");
  assert.equal(artifact.negative.reason, "missing_field_not_paid_demand");
  assert.equal(artifact.negative.declaredSdk === artifact.declaredSdk, false);
  assert.equal(artifact.resources.cash.atomic, "0");
  assert.equal(artifact.resources.cash.countsAsCash, true);
  assert.equal(artifact.resources.apiEquivalent.countsAsCash, false);
  assert.equal(artifact.resources.savings, "unknown");
  assert.equal(artifact.resources.founderCommissionIsThisRun, false);
  const buyer = JSON.parse(readFileSync(join(exp, "buyer", "path.json"), "utf8"));
  const invitation = JSON.parse(readFileSync(join(exp, "buyer", "invitation.json"), "utf8"));
  assert.deepEqual(buyer, buyerPath());
  assert.deepEqual(invitation, invitationPacket());
  assert.equal(buyer.humanPage, false);
  assert.equal(buyer.paidAudit.priceAtomic, "10000");
  assert.equal(buyer.paidAudit.purchaseRecommended, false);
  assert.equal(invitation.sent, false);
  assert.equal(invitation.doNotSend.includes("payment"), true);
  assert.equal(invitation.doNotSend.includes("email"), true);
  assert.equal(invitation.task.defect, false);
  assert.equal(invitation.task.order, false);
  const changed = {
    callerId: "later-agent",
    taskDigest: artifact.taskDigest,
    sdk: artifact.declaredSdk,
    origin: artifact.target.origin,
    method: artifact.target.method,
    resource: "/v1/quota-changed",
    expectValue: artifact.expected.value,
  };
  const callerPath = join(dir, "changed.json");
  writeFileSync(callerPath, `${JSON.stringify(changed)}\n`);
  const later = run([
    join(exp, "bin", "commercial-path.mjs"),
    "later",
    "--artifact",
    join(dir, "regression.json"),
    "--caller",
    callerPath,
  ]);
  assert.equal(later.status, 2, later.stdout);
  const laterBody = JSON.parse(later.stdout);
  assert.equal(laterBody.reason, "stale_applicability");
  assert.equal(laterBody.probed, false);
  assert.equal(laterBody.usefulTransferred, false);
  assert.equal(laterBody.paymentPermitted, false);
  const trustedPath = join(dir, "trusted.json");
  writeFileSync(trustedPath, `${JSON.stringify({ ...artifact, trusted: true })}\n`);
  const trusted = run([
    join(exp, "bin", "commercial-path.mjs"),
    "later",
    "--artifact",
    trustedPath,
    "--caller",
    callerPath,
  ]);
  assert.equal(trusted.status, 2);
  assert.equal(JSON.parse(trusted.stdout).reason, "submitted_artifact_is_not_trusted");
  const dirty = run([join(exp, "bin", "commercial-path.mjs"), "buyer"], { COMMERCE_DATA_DIR: dir });
  assert.equal(dirty.status, 2);
  assert.match(dirty.stderr, /producer_state_present/);
  spawnSync("rm", ["-rf", dir]);
});

test("a cold later consumer outside the repo refuses changed inputs and provider state", async () => {
  const root = await mkdtemp(join(tmpdir(), "seller-repair-cold-100308-"));
  const outside = root.startsWith(repo) ? join(tmpdir(), "seller-repair-cold-outside") : root;
  if (outside !== root) await rm(outside, { recursive: true, force: true });
  const { cp, mkdir } = await import("node:fs/promises");
  await mkdir(outside, { recursive: true });
  await cp(join(exp, "src", "later.mjs"), join(outside, "later.mjs"));
  const source = await readFile(join(exp, "commercial", "later-consumer.mjs"), "utf8");
  assert.equal(source.includes("express"), false);
  assert.equal(source.includes("commerce-events"), false);
  await writeFile(
    join(outside, "later-consumer.mjs"),
    source.replace('from "../src/later.mjs"', 'from "./later.mjs"'),
  );
  await cp(join(exp, "cold", "consume-later.mjs"), join(outside, "consume-later.mjs"));
  const artifact = JSON.parse(await readFile(join(exp, "commercial", "export", "regression.json"), "utf8"));
  const caller = JSON.parse(await readFile(join(exp, "buyer", "later-changed-caller.json"), "utf8"));
  await writeFile(join(outside, "artifact.json"), `${JSON.stringify(artifact)}\n`);
  await writeFile(join(outside, "caller.json"), `${JSON.stringify(caller)}\n`);
  const cold = spawnSync(node, [
    join(outside, "consume-later.mjs"),
    "--artifact",
    join(outside, "artifact.json"),
    "--caller",
    join(outside, "caller.json"),
  ], { cwd: outside, encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp" } });
  assert.equal(cold.status, 2, cold.stderr || cold.stdout);
  const body = JSON.parse(cold.stdout);
  assert.equal(body.reason, "stale_applicability");
  assert.equal(body.probed, false);
  assert.equal(body.privateImported, false);
  assert.equal(body.paymentSent, false);
  const blockedRun = spawnSync(node, [
    join(outside, "consume-later.mjs"),
    "--artifact",
    join(outside, "artifact.json"),
    "--caller",
    join(outside, "caller.json"),
  ], {
    cwd: outside,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME || "/tmp", COMMERCE_INTERNAL_TOKEN: "present" },
  });
  assert.equal(blockedRun.status, 2);
  assert.match(blockedRun.stderr, /producer_state_present/);
  await rm(outside, { recursive: true, force: true });
  assert.equal(blocked.includes("COMMERCE_DATA_DIR"), true);
});

function listenPort(pid) {
  return new Promise((resolve, reject) => {
    execFile("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"], (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || stdout || error.message));
      const match = stdout.match(/:(\d+)\s+\(LISTEN\)/);
      if (!match) return reject(new Error(`no listen port\n${stdout}`));
      resolve(Number(match[1]));
    });
  });
}

test("startup accepts an uncharged diagnosis and does not turn it into a 402", { timeout: 45_000 }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "commercial-startup-100308-"));
  const child = spawn(node, ["server.js"], {
    cwd: repo,
    env: {
      ...process.env,
      PORT: "0",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes("x402-merchant listening on :0")) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-2000)}`));
    });
  });
  try {
    assert.equal(await listening, true);
    const port = await listenPort(child.pid);
    const empty = await fetch(`http://127.0.0.1:${port}/commerce/seller-repair-diagnosis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const emptyBody = await empty.json();
    assert.notEqual(empty.status, 402);
    assert.equal(empty.status, 400);
    assert.equal(emptyBody.charged, false);
    assert.equal(emptyBody.paymentSent, false);
    assert.equal(emptyBody.usefulOutput.http200IsSuccess, false);
    const caller = {
      callerId: "startup-caller",
      origin: "https://quota.example",
      operation: "GET /v1/quota",
      sdk: "node-https@22",
      expect: { path: "quota.remaining", value: "3" },
      observed: { status: 200, json: { quota: { limit: 100 } }, contentType: "application/json" },
      probe: false,
      paidIntent: false,
    };
    const posted = await fetch(`http://127.0.0.1:${port}/commerce/seller-repair-diagnosis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(caller),
    });
    const postedBody = await posted.json();
    assert.notEqual(posted.status, 402);
    assert.equal(postedBody.charged, false);
    assert.equal(postedBody.paymentSent, false);
    assert.equal(postedBody.usefulOutput.http200IsSuccess, false);
    assert.equal(postedBody.paid.priceAtomic, "10000");
    assert.equal(postedBody.paid.purchaseRecommended, false);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  }
});
