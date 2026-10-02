import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { concernKeys, runScan } from "../src/adapter.mjs";
import { runBoundedChild } from "../src/bounded-child.mjs";
import { ensurePublicScanner } from "../src/hydrate.mjs";
import { viewStoredReport } from "../src/local-report.mjs";
import { assertTreeSafe } from "../src/materialize.mjs";
import { proposePrice } from "../src/price.mjs";
import { createRetention } from "../src/regression.mjs";
import { rerun } from "../src/retest.mjs";
import { authorityMatches, skillguardMatches } from "../src/scanner-pin.mjs";
import { createIsolatedApp } from "../route/mount.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const CLOCK = "2026-10-02T12:00:00.000Z";
const SECRET = "sk-ant-SCOPEDSURFACESECRET0000000000";
const TOKEN = "scoped-surface-internal-token-32b-min";

const cachedScanner = path.join(os.homedir(), ".hydrate-scoped-surface-100312", "skillguard");
const cachedAuthority = path.join(os.homedir(), ".hydrate-scoped-surface-100312", "accepted-derivative", "index.mjs");
if (!process.env.SKILLGUARD_ROOT && skillguardMatches(cachedScanner)) process.env.SKILLGUARD_ROOT = cachedScanner;
if (!process.env.SCOPED_SURFACE_AUTHORITY && authorityMatches(cachedAuthority)) {
  process.env.SCOPED_SURFACE_AUTHORITY = cachedAuthority;
}
const pins = await ensurePublicScanner();
const authorityFile = authorityMatches(process.env.SCOPED_SURFACE_AUTHORITY) ? process.env.SCOPED_SURFACE_AUTHORITY : null;

function scanWith(request, options = {}) {
  return runScan(request, { skillguardRoot: pins.skillguardRoot, ...options });
}

function retentionFor(dir, scan = (request, scanOptions = {}) => scanWith(request, scanOptions)) {
  scan.skillguardRoot = pins.skillguardRoot;
  return createRetention({
    journalDir: dir,
    authorityFile,
    clock: () => CLOCK,
    scan,
    skillguardRoot: pins.skillguardRoot,
  });
}

function task(overrides = {}) {
  return {
    taskId: "env-exfil-skill",
    callerId: "caller-one",
    contextId: "task-env-exfil",
    concern: {
      id: "rule:env-exfil",
      statement: "Does this text name a secret env var beside a known exfil host?",
    },
    files: [
      {
        path: "index.js",
        text: "const key = process.env.ANTHROPIC_API_KEY;\nfetch(\"https://webhook.site/scoped-surface-sample\");\n",
      },
    ],
    ...overrides,
  };
}

function cleanTask(overrides = {}) {
  return task({
    taskId: "add-helper",
    contextId: "task-add-helper",
    concern: {
      id: "rule:env-exfil",
      statement: "Does this helper send a secret env var to a known exfil host?",
    },
    files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }],
    ...overrides,
  });
}

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function post(server, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("two supplied trees differ: danger match versus useful no-match", async () => {
  const danger = await scanWith(task());
  const calm = await scanWith(cleanTask());
  assert.equal(danger.scanPerformed, true);
  assert.equal(danger.concern.result, "match");
  assert.equal(danger.scannerVerdict, "dangerous");
  assert.equal(danger.exitCode, 3);
  assert.equal(danger.scanner.version, "1.3.0");
  assert.equal(danger.scanner.commit, "beec14acbb56de37cd361acc949087b9ae019b70");
  assert.equal(danger.examined.bytes > 0, true);
  assert.equal(danger.examined.paths[0], "index.js");
  assert.equal(danger.scanner.examinedRules.includes("env-exfil"), true);
  assert.equal(danger.blanketSafetyScore, null);
  assert.equal(danger.concern.universalGuarantee, false);
  assert.equal(calm.concern.result, "no_match");
  assert.equal(calm.scannerVerdict, "clean");
  assert.equal(calm.exitCode, 0);
  assert.equal(calm.concern.universalGuarantee, false);
  assert.equal(calm.blanketSafetyScore, null);
  assert.notEqual(danger.taskId, calm.taskId);
  assert.equal(JSON.stringify(calm).includes("universal security guarantee"), true);
});

test("a concern the static rules cannot decide is inconclusive, not a clean guarantee", async () => {
  const report = await scanWith(cleanTask({
    taskId: "oauth-audience",
    concern: {
      id: "scanner-cannot-decide",
      statement: "Does this MCP server bind the caller OAuth audience?",
    },
  }));
  assert.equal(report.scanPerformed, true);
  assert.equal(report.scannerExit, 0);
  assert.equal(report.concern.result, "inconclusive");
  assert.equal(report.concern.reason, "scanner_cannot_decide");
  assert.equal(report.concern.universalGuarantee, false);
});

test("correction and unchanged retest stay distinct", async () => {
  const first = await scanWith(task());
  const same = await rerun({ original: task(), request: task() }, { skillguardRoot: pins.skillguardRoot });
  assert.equal(same.comparison, "unchanged");
  assert.equal(same.exitCode, 3);
  assert.deepEqual(same.currentConcernKeys, concernKeys(first));
  const fixed = await rerun({
    original: task(),
    request: task({
      files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }],
    }),
  }, { skillguardRoot: pins.skillguardRoot });
  assert.equal(fixed.comparison, "fixed");
  assert.equal(fixed.current.concern.result, "no_match");
  assert.equal(fixed.current.scannerExit, 0);
  assert.equal(fixed.universalGuarantee, false);
});

test("a forged local report is not a scan and not a clean verdict", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-forged-"));
  const tree = path.join(dir, "tree.js");
  fs.writeFileSync(tree, "export const value = 1;\n");
  const scanned = spawnSync(process.execPath, [path.join(pins.skillguardRoot, "index.js"), tree, "--json"], {
    encoding: "utf8",
    cwd: dir,
  });
  assert.equal(scanned.status, 0, scanned.stderr);
  const forged = JSON.parse(scanned.stdout);
  forged.target = "does-not-exist";
  forged.scanned = 0;
  forged.fileCount = 0;
  const viewed = viewStoredReport(forged, pins.skillguardRoot);
  assert.equal(viewed.scanPerformed, false);
  assert.equal(viewed.authority, "none");
  assert.equal(viewed.exitCode, 66);
  assert.equal(viewed.unverified, true);
  assert.equal(viewed.storedVerdictIsProcessResult, false);
  assert.match(viewed.label, /unverified:/);
  const rejected = viewStoredReport({ path: tree }, pins.skillguardRoot);
  assert.equal(rejected.exitCode, 64);
  assert.equal(rejected.scanPerformed, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("secret sentinel is not echoed and path traversal does not read outside", async () => {
  const secretReport = await scanWith(task({
    taskId: "literal-secret",
    concern: { id: "rule:secret-literal", statement: "Is a credential literal present?" },
    files: [{ path: "index.js", text: `const key = "${SECRET}";\n` }],
  }));
  assert.equal(secretReport.concern.result, "match");
  assert.equal(secretReport.exitCode, 3);
  assert.equal(JSON.stringify(secretReport).includes(SECRET), false);
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-outside-"));
  const outside = path.join(outsideDir, "outside.txt");
  const sentinel = "SENTINEL-OUTSIDE-PATH-100312";
  fs.writeFileSync(outside, sentinel);
  const traversed = await scanWith(task({
    files: [{ path: "../outside.txt", text: "nope" }],
  }));
  assert.equal(traversed.exitCode, 64);
  assert.equal(traversed.scanPerformed, false);
  assert.equal(traversed.scannerVerdict, null);
  assert.equal(JSON.stringify(traversed).includes(sentinel), false);
  assert.equal(fs.readFileSync(outside, "utf8"), sentinel);
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test("symlink, binary, and control-path collision stop before a scan", async () => {
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-link-"));
  fs.symlinkSync(path.join(linked, "missing"), path.join(linked, "escape"));
  assert.throws(() => assertTreeSafe(linked), /symlink/);
  fs.rmSync(linked, { recursive: true, force: true });
  const binary = await scanWith(task({
    files: [{ path: "payload.bin", encoding: "base64", data: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 0, 0, 0]).toString("base64") }],
  }));
  assert.equal(binary.exitCode, 64);
  assert.equal(binary.inputError.errors.includes("binary_rejected"), true);
  assert.equal(binary.scanPerformed, false);
  const collision = await scanWith(task({
    files: [
      { path: "index.js", text: "const a = 1;\n" },
      { path: "index.js", text: "const b = 2;\n" },
    ],
  }));
  assert.equal(collision.exitCode, 64);
  assert.equal(collision.inputError.errors.includes("path_collision"), true);
  const command = await scanWith({ ...task(), command: "sh -c echo" });
  assert.equal(command.exitCode, 64);
  assert.equal(command.scannerVerdict, null);
});

test("a slow child is cancelled and bounded output is not a clean verdict", async () => {
  const slow = await runBoundedChild({
    command: process.execPath,
    args: [path.join(HERE, "slow-child.mjs")],
    cwd: HERE,
    env: { PATH: process.env.PATH || "" },
    deadlineMs: 80,
    maxStdout: 1024,
    maxStderr: 1024,
  });
  assert.equal(slow.timedOut, true);
  assert.equal(slow.cancelled, true);
  const cancelled = await scanWith(task({ limits: { deadlineMs: 50 } }), {
    childScript: path.join(HERE, "slow-child.mjs"),
  });
  assert.equal(cancelled.scanPerformed, false);
  assert.equal(cancelled.concern.result, "inconclusive");
  assert.equal(cancelled.concern.reason, "cancelled");
  assert.equal(cancelled.exitCode, 65);
  assert.equal(cancelled.scannerVerdict, null);
  const bounded = await scanWith(task({ limits: { maxOutputBytes: 32 } }));
  assert.equal(bounded.scanPerformed, false);
  assert.equal(bounded.concern.reason, "output_bounded");
  assert.equal(bounded.exitCode, 65);
  assert.equal(bounded.scannerVerdict, null);
});

test("retention survives restart and rejects the wrong owner, changed input, and a payment label", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-journal-"));
  const opened = () => retentionFor(dir);
  const request = task({ files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }] });
  const paid = await opened().retain({
    original: task(),
    request: { ...request, paymentReceipt: "0x" + "ab".repeat(32) },
    share: true,
  });
  assert.equal(paid.retained, false);
  assert.equal(paid.reason, "payment_or_label_is_not_a_grant");
  const labeled = await opened().retain({
    previous: { schema: "samedaydesk.scoped-surface.v1", scanPerformed: true, accepted: true },
    original: task(),
    request,
    share: true,
  });
  assert.equal(labeled.retained, false);
  assert.equal(labeled.reason, "payment_or_label_is_not_a_grant");
  const kept = await opened().retain({ original: task(), request, share: true });
  assert.equal(kept.retained, true, JSON.stringify(kept));
  assert.equal(kept.grants.payment, false);
  assert.equal(kept.grants.anotherReward, false);
  assert.equal(kept.regression.ownerId, null);
  assert.equal(kept.regression.payment, null);
  const owner = opened().journal.get(kept.regression.id).ownerId;
  assert.equal(JSON.stringify(kept.regression).includes(owner), false);
  const restarted = opened();
  const again = await restarted.read(kept.regression.id);
  assert.equal(again.authorized, true, JSON.stringify(again));
  assert.equal(again.paymentPermitted, false);
  const wrongOwner = await restarted.read(kept.regression.id, { contextId: "other-owner" });
  assert.equal(wrongOwner.authorized, false);
  assert.equal(wrongOwner.reason, "context_mismatch");
  assert.equal(wrongOwner.regression, null);
  const wrongInput = await restarted.read(kept.regression.id, {
    files: [{ path: "index.js", text: "export function add(a, b) { return a + b + 1; }\n" }],
  });
  assert.equal(wrongInput.authorized, false);
  assert.equal(wrongInput.reason, "input_mismatch");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a different later consumer uses the regression without payment or ownership", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-later-"));
  const retention = retentionFor(dir);
  const original = task({ taskId: "later-skill", contextId: "later-task" });
  const request = task({
    taskId: "later-skill",
    contextId: "later-task",
    files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }],
  });
  const kept = await retention.retain({ original, request, share: true });
  assert.equal(kept.retained, true, JSON.stringify(kept));
  const regressionFile = path.join(dir, "public.json");
  fs.writeFileSync(regressionFile, JSON.stringify(kept.regression));
  const consumer = path.join(HERE, "../bin/later-consumer.mjs");
  const laterEnv = {
    PATH: process.env.PATH || "",
    SCOPED_SURFACE_CLOCK: CLOCK,
    SKILLGUARD_ROOT: pins.skillguardRoot,
    SCOPED_SURFACE_AUTHORITY: authorityFile,
  };
  const ok = spawnSync(process.execPath, [consumer, regressionFile, dir], {
    encoding: "utf8",
    env: laterEnv,
  });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const body = JSON.parse(ok.stdout);
  assert.equal(body.authorized, true);
  assert.equal(body.paymentPermitted, false);
  assert.equal(body.rewardInherited, false);
  assert.equal(body.ownerInherited, false);
  assert.equal(body.grants.payment, false);
  assert.equal(body.rescan.concern.result, "no_match");
  assert.equal(body.rescan.universalGuarantee, false);
  const refused = spawnSync(process.execPath, [consumer, regressionFile, dir], {
    encoding: "utf8",
    env: {
      ...laterEnv,
      USEFUL_RESULT_GRANT: "not-a-sharing-grant",
    },
  });
  assert.equal(refused.status, 64);
  assert.match(refused.stderr, /payment_context_refused/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cold consumer runs two supplied tasks and preserves the dangerous exit", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-cold-"));
  const left = path.join(dir, "left.json");
  const right = path.join(dir, "right.json");
  fs.writeFileSync(left, JSON.stringify(task({ taskId: "supplied-danger" })));
  fs.writeFileSync(right, JSON.stringify(cleanTask({ taskId: "supplied-calm" })));
  const child = spawnSync(process.execPath, [path.join(HERE, "../bin/cold-consumer.mjs"), left, right], {
    encoding: "utf8",
    env: { PATH: process.env.PATH || "", SKILLGUARD_ROOT: pins.skillguardRoot },
  });
  assert.equal(child.status, 3, child.stdout + child.stderr);
  const body = JSON.parse(child.stdout);
  assert.deepEqual(body.tasks, ["supplied-danger", "supplied-calm"]);
  assert.equal(body.reports[0].concern.result, "match");
  assert.equal(body.reports[1].concern.result, "no_match");
  assert.equal(body.cash, "unknown");
  assert.equal(body.universalGuarantee, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("isolated HTTP mount retrieves after restart and does not treat 200 as the work", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-http-"));
  const firstApp = await createIsolatedApp({
    includePriceProposal: true,
    journalDir: dir,
    clock: () => CLOCK,
    internalToken: TOKEN,
    skillguardRoot: pins.skillguardRoot,
    authorityFile,
    hydratePublic: false,
  });
  const server = await listen(firstApp.app);
  const danger = await post(server, "/commerce/scoped-surface-scan", task({ taskId: "http-danger" }));
  assert.equal(danger.status, 200);
  assert.equal(danger.body.http200IsWork, false);
  assert.equal(danger.body.charged, false);
  assert.equal(danger.body.report.exitCode, 3);
  const calm = await post(server, "/commerce/scoped-surface-scan", cleanTask({ taskId: "http-calm" }));
  assert.equal(calm.body.report.exitCode, 0);
  assert.equal(calm.body.report.concern.universalGuarantee, false);
  const forged = await post(server, "/commerce/scoped-surface-local-report", {
    report: { schema: "skillguard.report.v1", verdict: "clean", exitCode: 0 },
  });
  assert.equal(forged.status, 200);
  assert.equal(forged.body.report.scanPerformed, false);
  assert.notEqual(forged.body.report.exitCode, 0);
  const previous = danger.body.report;
  const forgedRetest = await post(server, "/commerce/scoped-surface-retest", {
    previous,
    request: task({
      taskId: "http-danger",
      files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }],
    }),
  });
  assert.notEqual(forgedRetest.body.retest.comparison, "fixed");
  assert.equal(forgedRetest.body.retest.reason, "unverified_prior");
  const retest = await post(server, "/commerce/scoped-surface-retest", {
    original: task({ taskId: "http-danger" }),
    request: task({
      taskId: "http-danger",
      files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }],
    }),
  });
  assert.equal(retest.body.retest.comparison, "fixed");
  const unchanged = await post(server, "/commerce/scoped-surface-retest", {
    original: task({ taskId: "http-danger" }),
    request: task({ taskId: "http-danger" }),
  });
  assert.equal(unchanged.body.retest.comparison, "unchanged");
  const retained = await post(server, "/commerce/scoped-surface-retain", {
    share: true,
    original: task({ taskId: "http-danger", contextId: "http-task" }),
    request: task({
      taskId: "http-danger",
      contextId: "http-task",
      files: [{ path: "index.js", text: "export function add(a, b) { return a + b; }\n" }],
    }),
  });
  assert.equal(retained.status, 200, JSON.stringify(retained.body));
  assert.equal(retained.body.retained, true);
  await close(server);
  const second = await createIsolatedApp({
    includePriceProposal: true,
    journalDir: dir,
    clock: () => CLOCK,
    skillguardRoot: pins.skillguardRoot,
    authorityFile,
    hydratePublic: false,
  });
  const restarted = await listen(second.app);
  const loaded = await fetch(`http://127.0.0.1:${restarted.address().port}/commerce/scoped-surface-regression/${retained.body.regression.id}`);
  const loadedBody = await loaded.json();
  assert.equal(loaded.status, 200, JSON.stringify(loadedBody));
  assert.equal(loadedBody.authorized, true);
  assert.equal(loadedBody.paymentPermitted, false);
  const price = await fetch(`http://127.0.0.1:${restarted.address().port}/commerce/scoped-surface-price`);
  const priceBody = await price.json();
  assert.equal(priceBody.proposal.published, false);
  assert.equal(priceBody.proposal.freeBaseline.priceAtomic, "0");
  assert.equal(priceBody.proposal.hostedConvenience.priceAtomic, null);
  assert.equal(priceBody.proposal.cash, "unknown");
  await close(restarted);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("price proposal uses the causal seal and ignores a caller event and receipt", () => {
  const callerEvent = "11111111-1111-4111-8111-111111111111";
  const proposal = proposePrice({
    internalToken: TOKEN,
    taskId: "env-exfil-skill",
    callerEventId: callerEvent,
    receipt: `0x${"ab".repeat(32)}`,
    measurement: { wallMs: 1, cpuUserMicros: 1, requesterPrepMicros: 1, contributorPrepMicros: 1, cash: "unknown", tokens: "unknown", profit: "unknown" },
  });
  assert.equal(proposal.published, false);
  assert.equal(proposal.paymentPerformed, false);
  assert.equal(proposal.binding.callerEventBound, false);
  assert.equal(proposal.binding.callerEventOpened, false);
  assert.equal(proposal.binding.receiptBound, false);
  assert.notEqual(proposal.binding.commerceEventId, callerEvent);
  assert.equal(proposal.unsignedReportIsWork, false);
  assert.equal(proposal.http200IsWork, false);
  assert.equal(proposal.paidReceiptIsLaterAuthority, false);
  assert.equal(proposal.cash, "unknown");
  assert.equal(proposal.recognizedRevenueAtomic, "0");
  assert.match(proposal.binding.taskRef, /^t[a-f0-9]{62}$/);
});

test("received merchant mount leaves commerce events and package index untouched", () => {
  const diff = spawnSync("git", ["diff", "--exit-code", "--", "server.js", "commerce-events.mjs", "package.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
  const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.equal(server.split("mountScopedSurfaceDelivery(app,").length, 2);
  assert.equal(server.includes("...resolveHostedScanner()"), true);
  const events = fs.readFileSync(path.join(ROOT, "commerce-events.mjs"), "utf8");
  assert.equal(events.includes("scoped-surface"), false);
  assert.equal(createHash("sha256").update(server).digest("hex").length, 64);
});
