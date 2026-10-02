import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";

import { acquisitionIndexSkill, mountMachineAcquisition, nodeEngineSatisfies } from "../machine-acquisition.mjs";
import { mountWellKnownSkills } from "../well-known-skills.mjs";
import { buildAcquisitionDocument, handlePublicAcquisitionRequest, loadPublicAcquisition, mountPublicAcquisition } from "./engine.mjs";
import { runReceiving } from "./receive.mjs";
import {
  ARTIFACT_SCHEMA,
  EVIDENCE_SCHEMA,
  MAX_ASSET_BYTES,
  MAX_REQUEST_MS,
  MAX_RUN_MS,
  PUBLIC_ACQUISITION_CURRENT_PATH,
  RECEIVING_MAX_AGE_MS,
  acquisitionTarget,
  commandDefinitionSha256,
  declaredRuntimeRange,
  loadColdCommandSet,
  loadReceivingFile,
  projectCurrentDelivery,
} from "./receiving-lifecycle.mjs";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const ORIGIN = "https://agents.samedaydesk.com";
const published = loadPublicAcquisition();
const commands = loadColdCommandSet();
const range = declaredRuntimeRange();

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    server.once("error", reject);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function hex(char) {
  return char.repeat(64);
}

function matchingArtifact(overrides = {}) {
  const origin = overrides.origin || ORIGIN;
  const version = overrides.version || "v22.20.0";
  const assets = published.order.map((rel) => {
    const asset = published.files.get(rel).asset;
    const url = `${origin}${`/.well-known/public-acquisition/assets/`}${rel}`;
    return {
      id: asset.id,
      version: asset.version,
      role: asset.role,
      filename: asset.filename,
      relativePath: rel,
      sha256: asset.sha256,
      bytes: asset.bytes,
      inventory: asset.role === "archive" ? {
        path: asset.inventory.path,
        fileSha256: asset.inventory.fileSha256,
        memberCount: asset.inventory.memberCount,
      } : null,
      acquisition: "match",
      get: {
        url,
        status: 200,
        bodyBytes: asset.bytes,
        bodySha256: asset.sha256,
        contentType: asset.mediaType,
        elapsedMs: 5,
        redirect: "refused",
      },
      head: {
        url,
        status: 200,
        bodyBytes: 0,
        contentLength: asset.bytes,
        elapsedMs: 4,
        redirect: "refused",
      },
    };
  });
  return {
    schema: ARTIFACT_SCHEMA,
    kind: "deployment-readback",
    proofClass: "public-origin",
    complete: true,
    configuredPublicOrigin: origin,
    observedAt: new Date(overrides.observedAt ?? NOW).toISOString(),
    manifest: {
      schema: "samedaydesk.public-acquisition.receiving.v1",
      sha256: overrides.manifestSha256 || published.manifestSha256,
      assetCount: published.order.length,
    },
    inventories: assets.filter((asset) => asset.role === "archive").map((asset) => asset.inventory),
    runtime: {
      name: "node",
      version,
      range: overrides.range || range,
      satisfied: nodeEngineSatisfies(version, overrides.range || range),
    },
    bounds: { redirects: "refused", maxAssetBytes: MAX_ASSET_BYTES, maxRequestMs: MAX_REQUEST_MS, maxRunMs: MAX_RUN_MS },
    assets,
    coldCommands: commands.commands.map((command) => ({
      id: command.id,
      version: command.version,
      filename: command.filename,
      definitionSha256: command.definitionSha256,
      coverage: "complete",
      steps: command.steps.map((step) => ({
        argv: step.argv,
        exitCode: 0,
        matched: true,
        missing: [],
        stdoutSha256: hex("a"),
        stdoutBytes: 24,
      })),
    })),
    qualifications: {
      sourceQualification: "unknown",
      privateGit: "unavailable",
      independentAdoption: false,
      paidLaunch: false,
      measuredSavings: false,
      purchaseAuthorization: false,
    },
    remoteIndex: {
      url: `${origin}/.well-known/public-acquisition/index.json`,
      status: 200,
      bytes: 128,
      sha256: hex("b"),
      draft: true,
      productionHosted: false,
      hostedAcquisitionVerified: false,
      assetCount: published.order.length,
    },
  };
}

function project(artifact, options = {}) {
  return projectCurrentDelivery({
    published: options.published || published,
    publicUrl: options.publicUrl === undefined ? ORIGIN : options.publicUrl,
    artifactState: artifact ? { kind: "loaded", value: artifact, sha256: hex("c") } : { kind: "candidate" },
    coldCommands: options.coldCommands === undefined ? commands : options.coldCommands,
    runtimeRange: range,
    now: options.now ?? NOW,
  });
}

function named(list, asset) {
  return list.find((item) => item.id === asset.id && item.version === asset.version && item.filename === asset.filename);
}

function byFile(document, filename) {
  return document.assets.find((asset) => asset.filename === filename);
}

function choiceFor(document, filename) {
  return document.choice.assets.find((asset) => asset.filename === filename);
}

test("candidate delivery keeps the frozen index and selects the primary origin", () => {
  const current = project(null);
  assert.equal(current.choice.disposition, "candidate");
  assert.equal(current.receiving.complete, false);
  assert.equal(current.receiving.availability, "candidate");
  assert.equal(current.frozenProvenance.draft, true);
  assert.equal(current.frozenProvenance.productionHosted, false);
  assert.equal(current.frozenProvenance.hostedAcquisitionVerified, false);
  assert.equal(current.frozenProvenance.historical, true);
  assert.equal(current.separateFromFrozenProvenance, true);
  assert.equal(Object.hasOwn(current, "success"), false);
  assert.equal(Object.hasOwn(current.receiving, "ok"), false);
  for (const entry of current.choice.assets) {
    const target = acquisitionTarget(entry);
    assert.equal(entry.route, "primary-origin");
    assert.equal(entry.because, "no-current-readback");
    assert.equal(target.fetch, true);
    assert.equal(target.url, entry.primaryUrl);
    assert.match(target.url, /^https:\/\/neomorphic\.io\/downloads\//);
  }
  assert.equal(current.freshness.maxAgeMs, RECEIVING_MAX_AGE_MS);
  assert.match(current.freshness.refresh, /receive\.mjs/);
  assert.match(current.freshness.refresh, /Do not edit product code/);
});

test("a fresh public readback selects the configured origin without collapsing qualifications", () => {
  const artifact = matchingArtifact();
  const current = project(artifact);
  assert.equal(current.choice.disposition, "received");
  assert.equal(current.receiving.complete, true);
  assert.equal(current.receiving.manifest, "matched");
  assert.equal(current.receiving.runtime.satisfied, true);
  assert.equal(current.receiving.runtime.pin, "matched");
  assert.equal(current.receiving.sourceQualification, "unknown");
  assert.equal(current.receiving.privateSource, "uninspected");
  assert.equal(current.receiving.independentAdoption, "not-evidenced");
  assert.equal(current.receiving.paidLaunch, "not-evidenced");
  assert.equal(current.receiving.measuredSavings, "not-evidenced");
  assert.equal(current.receiving.purchaseAuthorization, false);
  assert.equal(current.receiving.remoteIndexUsedForDecision, false);
  assert.equal(current.receiving.remoteIndexClaims.draft, true);
  assert.equal(current.receiving.remoteIndexClaims.hostedAcquisitionVerified, false);
  assert.equal(current.frozenProvenance.draft, true);
  assert.equal(current.frozenProvenance.hostedAcquisitionVerified, false);
  for (const asset of current.assets) {
    assert.equal(asset.acquisition, "acquired");
    assert.equal(asset.sourceQualification, "unknown");
    assert.equal(asset.privateSource, "uninspected");
    assert.equal(asset.independentAdoption, "not-evidenced");
    assert.equal(asset.paidLaunch, "not-evidenced");
    const entry = named(current.choice.assets, asset);
    const target = acquisitionTarget(entry);
    assert.equal(entry.route, "configured-public-origin");
    assert.equal(entry.because, "public-bytes-acquired");
    assert.equal(target.fetch, true);
    assert.equal(target.url, entry.publicUrl);
    assert.equal(target.sha256, asset.sha256);
  }
});

test("changed, missing, and revoked evidence stay qualified per asset", () => {
  const changed = matchingArtifact();
  const archiveName = changed.assets.find((asset) => asset.role === "archive").filename;
  const flipped = changed.assets.find((asset) => asset.filename === archiveName);
  flipped.get.bodySha256 = hex("d");
  const changedView = project(changed);
  assert.equal(changedView.choice.disposition, "partial");
  assert.equal(changedView.receiving.complete, false);
  assert.equal(byFile(changedView, archiveName).acquisition, "changed");
  assert.equal(choiceFor(changedView, archiveName).route, "withhold");
  assert.equal(choiceFor(changedView, archiveName).because, "public-bytes-changed");
  assert.equal(acquisitionTarget(choiceFor(changedView, archiveName)).fetch, false);
  const sibling = changedView.assets.find((asset) => asset.filename !== archiveName && asset.role === "archive");
  assert.equal(sibling.acquisition, "acquired");
  assert.equal(choiceFor(changedView, sibling.filename).route, "configured-public-origin");
  assert.equal(sibling.privateSource, "uninspected");

  const missing = matchingArtifact();
  const dropped = missing.assets.pop();
  const missingView = project(missing);
  assert.equal(named(missingView.assets, dropped).acquisition, "missing");
  assert.equal(named(missingView.choice.assets, dropped).route, "primary-origin");
  assert.equal(named(missingView.choice.assets, dropped).because, "public-asset-missing");
  assert.equal(missingView.receiving.complete, false);
  assert.equal(missingView.assets.filter((asset) => asset.acquisition === "acquired").length, published.order.length - 1);

  const revoked = project(matchingArtifact({ observedAt: NOW - RECEIVING_MAX_AGE_MS - 1_000 }));
  assert.equal(revoked.choice.disposition, "revoked");
  assert.equal(revoked.freshness.fresh, false);
  assert.equal(revoked.receiving.complete, false);
  assert.ok(revoked.receiving.ageMs > RECEIVING_MAX_AGE_MS);
  for (const asset of revoked.assets) {
    assert.equal(asset.acquisition, "revoked");
    assert.equal(named(revoked.choice.assets, asset).route, "primary-origin");
    assert.equal(named(revoked.choice.assets, asset).because, "readback-revoked");
  }
});

test("exact origin is required and a bad asset does not promote the readback", () => {
  const hosted = project(matchingArtifact(), { publicUrl: `${ORIGIN}/merchant` });
  assert.equal(hosted.choice.disposition, "received");
  const wrong = project(matchingArtifact({ origin: "https://example.test" }));
  assert.equal(wrong.choice.disposition, "rejected");
  assert.equal(wrong.receiving.rejection.code, "wrong_origin");
  assert.equal(wrong.assets.every((asset) => asset.acquisition === "unobserved"), true);
  assert.equal(choiceFor(wrong, wrong.choice.assets[0].filename).route, "primary-origin");
  const httpOrigin = matchingArtifact();
  httpOrigin.configuredPublicOrigin = "http://agents.samedaydesk.com";
  const insecure = project(httpOrigin);
  assert.equal(insecure.receiving.rejection.code, "wrong_origin");

  const bad = matchingArtifact();
  const one = bad.assets.find((asset) => asset.role === "license");
  one.get.status = 500;
  one.get.bodyBytes = 0;
  one.get.bodySha256 = null;
  one.acquisition = "error";
  const view = project(bad);
  assert.equal(view.choice.disposition, "partial");
  assert.equal(named(view.assets, one).acquisition, "mismatched");
  assert.equal(named(view.choice.assets, one).route, "withhold");
  assert.equal(view.assets.filter((asset) => asset.acquisition === "acquired").length, published.order.length - 1);
  assert.equal(view.frozenProvenance.draft, true);
});

test("partial command coverage and a source change invalidate only the affected evidence", () => {
  const partial = matchingArtifact();
  partial.coldCommands[0].coverage = "partial";
  partial.coldCommands[0].steps[0].matched = false;
  partial.coldCommands[0].steps[0].missing = ["missing-needle"];
  const partialView = project(partial);
  const partialAsset = partialView.assets.find((asset) => asset.id === partial.coldCommands[0].id && asset.role === "archive");
  assert.equal(partialAsset.acquisition, "acquired");
  assert.equal(partialAsset.usefulCommand, "partial");
  assert.equal(choiceFor(partialView, partialAsset.filename).because, "public-bytes-acquired-command-incomplete");
  assert.equal(choiceFor(partialView, partialAsset.filename).route, "configured-public-origin");
  const other = partialView.assets.find((asset) => asset.role === "archive" && asset.id !== partialAsset.id);
  assert.equal(other.usefulCommand, "matched");
  assert.equal(partialView.receiving.complete, false);
  assert.equal(partialView.choice.disposition, "partial");

  const shiftedCommands = structuredClone(commands);
  shiftedCommands.commands[0].steps[0].stdoutIncludes = ["source-changed"];
  shiftedCommands.commands[0].definitionSha256 = commandDefinitionSha256(shiftedCommands.commands[0]);
  const shifted = project(matchingArtifact(), { coldCommands: shiftedCommands });
  const affected = shifted.assets.find((asset) => asset.id === shiftedCommands.commands[0].id && asset.role === "archive");
  const unaffected = shifted.assets.find((asset) => asset.role === "archive" && asset.id !== affected.id);
  assert.equal(affected.usefulCommand, "invalidated");
  assert.equal(affected.acquisition, "acquired");
  assert.equal(unaffected.usefulCommand, "matched");
  assert.equal(unaffected.acquisition, "acquired");

  const manifestChanged = project(matchingArtifact({ manifestSha256: hex("e") }));
  assert.equal(manifestChanged.receiving.manifest, "changed");
  assert.equal(manifestChanged.receiving.complete, false);
  assert.equal(manifestChanged.assets.every((asset) => asset.acquisition === "acquired"), true);

  const inventory = matchingArtifact();
  inventory.inventories[0].fileSha256 = hex("f");
  inventory.assets.find((asset) => asset.inventory?.path === inventory.inventories[0].path).inventory.fileSha256 = hex("f");
  const inventoryView = project(inventory);
  const inventoryAsset = inventoryView.assets.find((asset) => asset.role === "archive" && asset.inventory === "invalidated");
  assert.ok(inventoryAsset);
  assert.equal(inventoryAsset.acquisition, "acquired");
  const archiveCount = inventoryView.assets.filter((asset) => asset.role === "archive").length;
  assert.equal(inventoryView.assets.filter((asset) => asset.inventory === "matched").length, archiveCount - 1);

  const runtime = matchingArtifact({ version: "v22.14.0" });
  const runtimeView = project(runtime);
  assert.equal(runtimeView.receiving.runtime.satisfied, false);
  assert.equal(runtimeView.receiving.complete, false);
  assert.equal(runtimeView.assets.every((asset) => asset.acquisition === "acquired"), true);

  const unpublished = matchingArtifact();
  unpublished.complete = false;
  assert.equal(project(unpublished).choice.disposition, "partial");
});

test("unexpected fields, wrong proof, future time, and symlink bytes are rejected", () => {
  const extra = matchingArtifact();
  extra.success = true;
  extra.gitCommit = "abc";
  const loaded = loadReceivingFile(writeArtifact(extra));
  assert.equal(loaded.kind, "rejected");
  assert.equal(loaded.code, "unexpected_field");
  assert.equal(loaded.message, "receiving artifact does not match its schema");
  const rejected = projectCurrentDelivery({
    published,
    publicUrl: ORIGIN,
    artifactState: loaded,
    coldCommands: commands,
    runtimeRange: range,
    now: NOW,
  });
  assert.equal(rejected.choice.disposition, "rejected");
  assert.equal(rejected.choice.assets.every((entry) => entry.route === "primary-origin"), true);

  const evidenceFile = writeArtifact({ schema: EVIDENCE_SCHEMA, complete: true, success: true });
  const evidenceLoad = loadReceivingFile(evidenceFile);
  assert.equal(evidenceLoad.kind, "rejected");
  assert.equal(evidenceLoad.code, "unexpected_field");

  const future = matchingArtifact({ observedAt: NOW + 60 * 60 * 1000 });
  assert.equal(project(future).receiving.rejection.code, "invalid_observation");

  const paid = matchingArtifact();
  paid.qualifications.paidLaunch = true;
  assert.equal(loadReceivingFile(writeArtifact(paid)).code, "unearned_claim");

  const linkDir = mkdtempSync(join(tmpdir(), "receiving-link-"));
  const target = join(linkDir, "real.json");
  const link = join(linkDir, "artifact.json");
  writeFileSync(target, `${JSON.stringify(matchingArtifact())}\n`);
  symlinkSync(target, link);
  const linked = loadReceivingFile(link);
  assert.equal(linked.kind, "rejected");
  assert.equal(linked.code, "symlink");
});

test("restart rereads the local artifact and absence stays optional", async () => {
  const dir = mkdtempSync(join(tmpdir(), "receiving-restart-"));
  const artifactPath = join(dir, "artifact.json");
  const app = express();
  app.disable("x-powered-by");
  mountMachineAcquisition(app, { publicUrl: ORIGIN });
  mountWellKnownSkills(app, { publicUrl: ORIGIN, extraIndexSkills: [acquisitionIndexSkill()] });
  mountPublicAcquisition(app, { publicUrl: ORIGIN, receivingPath: artifactPath, now: () => NOW });
  app.get("/extract", (_req, res) => {
    res.status(402).json({ charged: false, route: "GET /extract" });
  });
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const first = await fetch(`http://127.0.0.1:${port}${PUBLIC_ACQUISITION_CURRENT_PATH}`);
    const candidate = await first.json();
    assert.equal(candidate.choice.disposition, "candidate");
    const index = await fetch(`http://127.0.0.1:${port}/.well-known/public-acquisition/index.json`);
    const frozen = await index.json();
    assert.equal(frozen.draft, true);
    assert.equal(frozen.productionHosted, false);
    assert.equal(frozen.hostedAcquisitionVerified, false);
    assert.equal(frozen.currentDelivery.path, PUBLIC_ACQUISITION_CURRENT_PATH);
    assert.match(index.headers.get("link"), /rel="current"/);

    writeFileSync(artifactPath, `${JSON.stringify(matchingArtifact())}\n`);
    const received = await (await fetch(`http://127.0.0.1:${port}${PUBLIC_ACQUISITION_CURRENT_PATH}`)).json();
    assert.equal(received.choice.disposition, "received");
    assert.equal(received.frozenProvenance.draft, true);
    const head = await fetch(`http://127.0.0.1:${port}${PUBLIC_ACQUISITION_CURRENT_PATH}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("cache-control"), "no-store");
    assert.equal(Buffer.from(await head.arrayBuffer()).length, 0);

    const restarted = express();
    restarted.disable("x-powered-by");
    mountPublicAcquisition(restarted, { publicUrl: ORIGIN, receivingPath: artifactPath, now: () => NOW });
    const again = http.createServer(restarted);
    const againPort = await listen(again);
    const afterRestart = await (await fetch(`http://127.0.0.1:${againPort}${PUBLIC_ACQUISITION_CURRENT_PATH}`)).json();
    assert.equal(afterRestart.choice.disposition, "received");
    assert.equal(afterRestart.receiving.artifactSha256, received.receiving.artifactSha256);
    await close(again);

    const stale = matchingArtifact({ observedAt: NOW - RECEIVING_MAX_AGE_MS - 5_000 });
    writeFileSync(artifactPath, `${JSON.stringify(stale)}\n`);
    const revoked = await (await fetch(`http://127.0.0.1:${port}${PUBLIC_ACQUISITION_CURRENT_PATH}`)).json();
    assert.equal(revoked.choice.disposition, "revoked");

    const skill = await fetch(`http://127.0.0.1:${port}/.well-known/skills/route-lock-receipt/SKILL.md`);
    assert.equal(skill.status, 200);
    assert.match(await skill.text(), /route-lock-receipt/);
    const paid = await fetch(`http://127.0.0.1:${port}/extract`);
    assert.equal(paid.status, 402);
    assert.equal((await paid.json()).charged, false);
    rmSync(artifactPath);
    const absent = await (await fetch(`http://127.0.0.1:${port}${PUBLIC_ACQUISITION_CURRENT_PATH}`)).json();
    assert.equal(absent.choice.disposition, "candidate");
  } finally {
    await close(server);
  }
});

test("a direct current request is served beside the frozen index", () => {
  const loaded = published;
  const artifactPath = writeArtifact(matchingArtifact());
  const current = {
    statusCode: 200,
    headers: {},
    body: Buffer.alloc(0),
    status(code) { this.statusCode = code; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = String(value); return this; },
    end(chunk) { if (chunk !== undefined) this.body = Buffer.from(chunk); return this; },
  };
  handlePublicAcquisitionRequest({
    method: "GET",
    path: PUBLIC_ACQUISITION_CURRENT_PATH,
    originalUrl: PUBLIC_ACQUISITION_CURRENT_PATH,
  }, current, { published: loaded, publicUrl: ORIGIN, receivingPath: artifactPath, now: NOW });
  const document = JSON.parse(current.body.toString("utf8"));
  assert.equal(document.choice.disposition, "received");
  assert.equal(document.choice.use, "route");
  assert.equal(handlePublicAcquisitionRequest({
    method: "GET",
    path: "/extract",
    originalUrl: "/extract",
  }, current, { published: loaded, publicUrl: ORIGIN }), false);
});

test("public and loopback proofs stay distinct, and a redirect cannot publish", async () => {
  const refusedArtifact = join(mkdtempSync(join(tmpdir(), "receiving-usage-artifact-")), "artifact.json");
  const refused = await runReceiving({
    proof: "public",
    origin: "http://127.0.0.1:9",
    evidencePath: join(mkdtempSync(join(tmpdir(), "receiving-usage-")), "evidence.json"),
    artifactPath: refusedArtifact,
  });
  assert.equal(refused.status, 2);
  assert.equal(refused.evidence.artifactWritten, false);
  assert.throws(() => readFileSync(refusedArtifact));

  const loopbackArtifact = join(mkdtempSync(join(tmpdir(), "receiving-loop-artifact-")), "artifact.json");
  const loopbackRefuse = await runReceiving({
    proof: "loopback",
    origin: "http://127.0.0.1:9",
    evidencePath: join(mkdtempSync(join(tmpdir(), "receiving-loop-evidence-")), "evidence.json"),
    artifactPath: loopbackArtifact,
  });
  assert.equal(loopbackRefuse.status, 2);
  assert.equal(loopbackRefuse.evidence.artifactWritten, false);
  assert.throws(() => readFileSync(loopbackArtifact));

  const redirect = http.createServer((_req, res) => {
    res.writeHead(302, { Location: "https://example.test/away", "Content-Length": "0" });
    res.end();
  });
  const port = await listen(redirect);
  const evidencePath = join(mkdtempSync(join(tmpdir(), "receiving-redirect-")), "evidence.json");
  try {
    const result = await runReceiving({
      proof: "loopback",
      origin: `http://127.0.0.1:${port}`,
      evidencePath,
    });
    assert.equal(result.status, 4);
    assert.equal(result.evidence.artifactWritten, false);
    assert.equal(result.evidence.observationComplete, false);
    assert.equal(result.evidence.remoteIndex.redirected, true);
    assert.equal(result.evidence.assets.some((asset) => asset.redirected), true);
    assert.equal(result.evidence.publishBlockedBy.includes("partial-observation"), true);
    assert.equal(result.evidence.publishBlockedBy.includes("proof-class"), true);
    const saved = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(saved.schema, EVIDENCE_SCHEMA);
    assert.equal(saved.artifactWritten, false);
  } finally {
    await close(redirect);
  }
});

test("a stopped run exports evidence and does not write a receiving artifact", async () => {
  const controller = new AbortController();
  controller.abort();
  const evidencePath = join(mkdtempSync(join(tmpdir(), "receiving-stop-")), "evidence.json");
  const result = await runReceiving({
    proof: "loopback",
    origin: "http://127.0.0.1:9",
    evidencePath,
    signal: controller.signal,
  });
  assert.equal(result.status, 3);
  assert.equal(result.evidence.stopped, true);
  assert.equal(result.evidence.artifactWritten, false);
  assert.equal(result.evidence.observationComplete, false);
  const saved = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(saved.stopped, true);
  assert.equal(saved.artifactWritten, false);
});

test("loopback receiving observes the mounted bytes and cold commands without publishing", { timeout: 120_000 }, async () => {
  const app = express();
  app.disable("x-powered-by");
  mountPublicAcquisition(app, { publicUrl: ORIGIN });
  const server = http.createServer(app);
  const port = await listen(server);
  const evidencePath = join(mkdtempSync(join(tmpdir(), "receiving-live-")), "evidence.json");
  try {
    const result = await runReceiving({
      proof: "loopback",
      origin: `http://127.0.0.1:${port}`,
      evidencePath,
    });
    assert.equal(result.status, 0, JSON.stringify(result.evidence.errors));
    assert.equal(result.evidence.observationComplete, true);
    assert.equal(result.evidence.artifactWritten, false);
    assert.equal(result.evidence.proofClass, "loopback");
    assert.equal(result.evidence.publishBlockedBy.includes("proof-class"), true);
    assert.equal(result.evidence.remoteIndex.draft, true);
    assert.equal(result.evidence.remoteIndex.productionHosted, false);
    assert.equal(result.evidence.assets.length, published.order.length);
    assert.equal(result.evidence.assets.every((asset) => asset.acquisition === "match"), true);
    assert.equal(result.evidence.coldCommands.length, commands.commands.length);
    assert.equal(result.evidence.coldCommands.every((command) => command.coverage === "complete"), true);
    assert.equal(result.evidence.runtime.name, "node");
    assert.equal(typeof result.evidence.runtime.satisfied, "boolean");
    const saved = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(saved.observationComplete, true);
    assert.equal(saved.artifactWritten, false);
  } finally {
    await close(server);
  }
});

function writeArtifact(value) {
  const dir = mkdtempSync(join(tmpdir(), "receiving-artifact-"));
  const path = join(dir, "artifact.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

test("a public proof parses a readback and does not publish when the runtime pin is unmet", { timeout: 120_000 }, async () => {
  const indexBody = Buffer.from(`${JSON.stringify(buildAcquisitionDocument(published, { publicUrl: ORIGIN }))}\n`);
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    let body = Buffer.alloc(0);
    let type = "application/octet-stream";
    if (url.endsWith("/index.json")) {
      body = indexBody;
      type = "application/json";
    } else {
      const rel = url.split("/.well-known/public-acquisition/assets/")[1];
      const stored = published.files.get(rel);
      type = stored.asset.mediaType;
      if (method !== "HEAD") body = stored.bytes;
      else body = Buffer.alloc(0);
      return bufferedResponse(method === "HEAD" ? 200 : 200, body, {
        "content-type": type,
        "content-length": String(stored.bytes.length),
      });
    }
    return bufferedResponse(200, body, { "content-type": type, "content-length": String(body.length) });
  };
  const artifactPath = join(mkdtempSync(join(tmpdir(), "receiving-public-artifact-")), "artifact.json");
  const evidencePath = join(mkdtempSync(join(tmpdir(), "receiving-public-evidence-")), "evidence.json");
  const result = await runReceiving({
    proof: "public",
    origin: ORIGIN,
    evidencePath,
    artifactPath,
    fetchImpl,
    now: () => new Date(NOW),
  });
  assert.equal(result.evidence.observationComplete, true, JSON.stringify({
    errors: result.evidence.errors,
    assets: result.evidence.assets,
    commands: result.evidence.coldCommands,
  }));
  assert.equal(result.evidence.artifactParsed, true, JSON.stringify(result.evidence.errors));
  if (result.evidence.runtime.satisfied) {
    assert.equal(result.status, 0);
    assert.equal(result.evidence.artifactWritten, true);
    const loaded = loadReceivingFile(artifactPath);
    assert.equal(loaded.kind, "loaded");
    const current = project(loaded.value, { now: NOW });
    assert.equal(current.choice.disposition, "received");
  } else {
    assert.equal(result.status, 4);
    assert.equal(result.evidence.artifactWritten, false);
    assert.equal(result.evidence.publishBlockedBy.includes("runtime"), true);
    assert.throws(() => readFileSync(artifactPath));
  }
  assert.equal(result.evidence.remoteIndex.draft, true);
  assert.equal(result.evidence.proofClass, "public");
});

function bufferedResponse(status, body, headers) {
  const payload = Buffer.from(body);
  return {
    status,
    headers: { get(name) { return headers[String(name).toLowerCase()] ?? null; } },
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent || payload.length === 0) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: payload };
          },
          async cancel() {},
        };
      },
    },
  };
}

test("the default command line refuses a public claim from a loopback origin", async () => {
  const child = spawn(process.execPath, [
    new URL("./receive.mjs", import.meta.url).pathname,
    "--proof", "public",
    "--origin", "http://127.0.0.1:9",
    "--artifact", join(mkdtempSync(join(tmpdir(), "receiving-cli-artifact-")), "artifact.json"),
    "--evidence", join(mkdtempSync(join(tmpdir(), "receiving-cli-evidence-")), "evidence.json"),
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  const code = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(code, 2);
  const summary = JSON.parse(Buffer.concat(stdout).toString("utf8"));
  assert.equal(summary.artifactWritten, false);
  assert.equal(summary.proofClass, "public");
});
