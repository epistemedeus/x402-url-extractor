import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authenticateJournalCut, JOURNAL_CUT_SCHEMA } from "./commerce-journal-cut-auth.mjs";
import {
  COMMERCE_COVERAGE_COMPLETE,
  COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW,
  COMMERCE_INTEGRITY_OK,
  COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT,
  COMMERCE_INTEGRITY_UNUSABLE_RECORDS,
  COMMERCE_PROSPECTIVE_MAX_AGE_MS,
  COMMERCE_PROSPECTIVE_SEGMENT_COUNT,
  COMMERCE_PROSPECTIVE_TAIL_SCHEMA,
  createCommerceTelemetry,
  resolveProspectiveRetention,
} from "./commerce-events.mjs";

const TOKEN = "prospective-retention-token-32b-min";
const HOUR_MS = 60 * 60 * 1000;
const EVENTS_MODULE = JSON.stringify(new URL("./commerce-events.mjs", import.meta.url).href);

function emit(telemetry, { requestPath = "/openapi.json", ip = "203.0.113.10", status = 200 } = {}) {
  const listeners = new Map();
  telemetry.middleware({
    path: requestPath,
    url: requestPath,
    method: "GET",
    headers: { "user-agent": "Agent402/1.0" },
    query: {},
    ip,
    socket: {},
  }, {
    statusCode: status,
    once(name, listener) { listeners.set(name, listener); },
    getHeader() { return undefined; },
  }, () => {});
  listeners.get("finish")?.();
}

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileBytes(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function signedCut(token, { fromMs = Date.now() - 5000, asOfMs = Date.now() - 1000 } = {}) {
  const body = {
    schema: JOURNAL_CUT_SCHEMA,
    kind: "attempt_useful_capture",
    cutId: randomUUID(),
    sessionId: randomUUID(),
    namespace: "7:11",
    producer: "canonical_commerce_and_useful_result_journals",
    writerProcesses: 1,
    sourceDigest: "cd".repeat(32),
    planes: { attempts: { coverage: "complete" } },
    from: new Date(fromMs).toISOString(),
    asOf: new Date(asOfMs).toISOString(),
  };
  const authentication = createHmac("sha256", token)
    .update("attempt-useful-cut-v1\n")
    .update(JSON.stringify(body))
    .digest("hex");
  return { ...body, authentication };
}

async function producedBoundary(dataDir) {
  const telemetry = createCommerceTelemetry({
    dataDir,
    secret: "boundary-shape-secret",
    internalToken: TOKEN,
    maxBytes: 1024 * 1024,
  });
  emit(telemetry, { ip: "203.0.113.21" });
  await telemetry.flush();
  const line = (await readFile(telemetry.paths.currentPath, "utf8")).trim().split("\n")[0];
  const produced = JSON.parse(line);
  const boundary = {
    ...produced,
    id: randomUUID(),
    ts: new Date(Date.now() - 25 * HOUR_MS).toISOString(),
  };
  return { produced, boundary, bytes: Buffer.from(`${JSON.stringify(boundary)}\n`) };
}

async function countId(dir, telemetry, id) {
  let found = 0;
  for (const filePath of telemetry.paths.segmentPaths) {
    const bytes = await fileBytes(filePath);
    if (!bytes) continue;
    for (const line of bytes.toString("utf8").split("\n")) {
      if (line.includes(id)) found += 1;
    }
  }
  const names = await readdir(dir);
  return { found, names };
}

test("bad prospective bounds are rejected by the producer", () => {
  assert.throws(
    () => createCommerceTelemetry({ dataDir: os.tmpdir(), retentionSegments: 1 }),
    /segment count must be an integer from 2 to 16/,
  );
  assert.throws(
    () => createCommerceTelemetry({ dataDir: os.tmpdir(), aggregateMaxBytes: 1024, maxBytes: 5 * 1024 * 1024 }),
    /current and rotated segments/,
  );
  assert.throws(
    () => resolveProspectiveRetention({ maxAgeMs: 0 }),
    /age must be a positive safe integer/,
  );
  const recommended = resolveProspectiveRetention({});
  assert.equal(recommended.segmentCount, COMMERCE_PROSPECTIVE_SEGMENT_COUNT);
  assert.equal(recommended.segmentMaxBytes, 5 * 1024 * 1024);
  assert.equal(recommended.aggregateMaxBytes, 4 * 5 * 1024 * 1024);
  assert.equal(recommended.maxAgeMs, COMMERCE_PROSPECTIVE_MAX_AGE_MS);
  assert.equal(recommended.readCapBytes, recommended.segmentMaxBytes + 8192);
});

test("a new or short producer stays unknown instead of a complete-window zero", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-short-producer-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "short-producer-secret",
      internalToken: TOKEN,
      requestConstructionSince: "2020-01-01T00:00:00.000Z",
    });
    const empty = await telemetry.snapshot({ days: 1 });
    assert.equal(empty.requestedWindowComplete, false);
    assert.equal(empty.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
    assert.equal(empty.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(empty.retainedParseableEventCount, 0);
    assert.equal(empty.externalEvents, 0);
    assert.equal(empty.coverage.prospectiveTail.occupiedSegments, 0);
    assert.equal(empty.coverage.prospectiveTail.historicalBackfill, false);
    assert.equal(empty.coverage.prospectiveTail.windowReachIsNotUptime, true);
    emit(telemetry, { ip: "203.0.113.11" });
    await telemetry.flush();
    const short = await telemetry.snapshot({ days: 1 });
    assert.equal(short.retainedParseableEventCount, 1);
    assert.equal(short.requestedWindowComplete, false);
    assert.equal(short.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
    assert.equal(short.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(short.coverage.prospectiveTail.occupiedSegments, 1);
    assert.equal(short.coverage.prospectiveTail.capacityWithheld, false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("two-file rotations still discard a 24-hour boundary and stay unknown", async () => {
  const shapeDir = await mkdtemp(path.join(os.tmpdir(), "commerce-boundary-shape-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-baseline-two-file-"));
  try {
    const { boundary, bytes } = await producedBoundary(shapeDir);
    await writeFile(path.join(dataDir, "commerce-events.ndjson"), bytes, { mode: 0o600 });
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "baseline-two-file-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      retentionSegments: 2,
      requestConstructionSince: "2020-01-01T00:00:00.000Z",
    });
    emit(telemetry, { ip: "203.0.113.31" });
    emit(telemetry, { ip: "203.0.113.32" });
    await telemetry.flush();
    const seen = await countId(dataDir, telemetry, boundary.id);
    assert.equal(seen.found, 0);
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.requestedWindowComplete, false);
    assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
    assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(snapshot.coverage.prospectiveTail.segmentCount, 2);
    assert.equal(snapshot.coverage.prospectiveTail.historicalBackfill, false);
    assert.equal(snapshot.coverage.prospectiveTail.windowReachIsNotUptime, true);
    assert.equal(JSON.stringify(snapshot).includes(boundary.id), false);
    assert.equal(JSON.stringify(snapshot).includes(boundary.ts), false);
  } finally {
    await rm(shapeDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("prospective segments keep a 24-hour boundary across ordinary rotations until capacity is exhausted", async () => {
  const shapeDir = await mkdtemp(path.join(os.tmpdir(), "commerce-prospective-shape-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-prospective-keep-"));
  try {
    const { boundary, bytes } = await producedBoundary(shapeDir);
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dataDir, "commerce-events.ndjson"), bytes, { mode: 0o600 });
    const before = sha(bytes);
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "prospective-keep-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      requestConstructionSince: "2020-01-01T00:00:00.000Z",
      agentDiscoverySince: "2020-01-01T00:00:00.000Z",
    });
    assert.equal(telemetry.paths.segmentPaths.length, COMMERCE_PROSPECTIVE_SEGMENT_COUNT);
    emit(telemetry, { ip: "203.0.113.41" });
    emit(telemetry, { ip: "203.0.113.42" });
    await telemetry.flush();
    const kept = await countId(dataDir, telemetry, boundary.id);
    assert.equal(kept.found, 1);
    const heldBytes = await fileBytes(telemetry.paths.segmentPaths[2]);
    assert.equal(sha(heldBytes), before);
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(sha(await readFile(telemetry.paths.segmentPaths[2])), before);
    assert.equal(snapshot.requestedWindowComplete, true);
    assert.equal(snapshot.requestedWindowCoverage, COMMERCE_COVERAGE_COMPLETE);
    assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(snapshot.coverage.prospectiveTail.schemaVersion, COMMERCE_PROSPECTIVE_TAIL_SCHEMA);
    assert.equal(snapshot.coverage.prospectiveTail.gap, false);
    assert.equal(snapshot.coverage.prospectiveTail.capacityWithheld, false);
    assert.equal(snapshot.coverage.prospectiveTail.discardedHistoryStaysLost, true);
    assert.equal(snapshot.coverage.prospectiveTail.windowReachIsNotUniqueCustomers, true);
    assert.equal(snapshot.coverage.prospectiveTail.windowReachIsNotConversionDenominator, true);
    assert.ok(snapshot.retainedParseableEventCount >= 3);
    for (let index = 0; index < COMMERCE_PROSPECTIVE_SEGMENT_COUNT; index += 1) {
      emit(telemetry, { ip: `203.0.113.${50 + index}` });
    }
    await telemetry.flush();
    const lost = await countId(dataDir, telemetry, boundary.id);
    assert.equal(lost.found, 0);
    const exhausted = await telemetry.snapshot({ days: 1 });
    assert.equal(exhausted.requestedWindowComplete, false);
    assert.equal(exhausted.requestedWindowCoverage, COMMERCE_COVERAGE_UNKNOWN_FOR_FULL_WINDOW);
    assert.equal(exhausted.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(JSON.stringify(exhausted).includes(boundary.id), false);
  } finally {
    await rm(shapeDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("restart and a shorter admission list do not rewrite or delete unadmitted segments", async () => {
  const shapeDir = await mkdtemp(path.join(os.tmpdir(), "commerce-restart-shape-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-restart-tail-"));
  try {
    const { boundary, bytes } = await producedBoundary(shapeDir);
    await writeFile(path.join(dataDir, "commerce-events.ndjson"), bytes, { mode: 0o600 });
    const writer = createCommerceTelemetry({
      dataDir,
      secret: "restart-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1,
    });
    emit(writer, { ip: "203.0.113.61" });
    emit(writer, { ip: "203.0.113.62" });
    await writer.flush();
    const segmentFile = writer.paths.segmentPaths[2];
    const digest = sha(await readFile(segmentFile));
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createCommerceTelemetry } from ${EVENTS_MODULE};
      const telemetry = createCommerceTelemetry({
        dataDir: process.env.COMMERCE_TEST_DIR,
        secret: "restart-tail-secret",
        internalToken: ${JSON.stringify(TOKEN)},
        maxBytes: 1,
      });
      const snapshot = await telemetry.snapshot({ days: 1 });
      if (snapshot.requestedWindowComplete !== true) process.exit(2);
      if (snapshot.retainedParseableEventCount < 1) process.exit(3);
      if (JSON.stringify(snapshot).includes(${JSON.stringify(boundary.id)})) process.exit(4);
      process.stdout.write(String(snapshot.retainedParseableEventCount));
    `], {
      env: { ...process.env, COMMERCE_TEST_DIR: dataDir },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.signal, null);
    assert.equal(sha(await readFile(segmentFile)), digest);
    const shortened = createCommerceTelemetry({
      dataDir,
      secret: "restart-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      retentionSegments: 2,
    });
    emit(shortened, { ip: "203.0.113.63" });
    await shortened.flush();
    assert.equal(sha(await readFile(segmentFile)), digest);
    const narrowed = await shortened.snapshot({ days: 1 });
    assert.equal(JSON.stringify(narrowed).includes(boundary.id), false);
    assert.equal(narrowed.requestedWindowComplete, false);
    const refused = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createCommerceTelemetry } from ${EVENTS_MODULE};
      createCommerceTelemetry({ dataDir: process.env.COMMERCE_TEST_DIR, retentionSegments: 1 });
    `], {
      env: { ...process.env, COMMERCE_TEST_DIR: dataDir },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.notEqual(refused.status, 0);
    assert.equal(refused.signal, null);
  } finally {
    await rm(shapeDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("existing current and rotated files migrate by read without new segments or rewritten rows", async () => {
  const shapeDir = await mkdtemp(path.join(os.tmpdir(), "commerce-migrate-shape-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-migrate-two-file-"));
  try {
    const { boundary, produced } = await producedBoundary(shapeDir);
    const older = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 30 * HOUR_MS).toISOString() };
    const recent = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 60 * 1000).toISOString() };
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const rotatedPath = path.join(dataDir, "commerce-events.1.ndjson");
    const currentPath = path.join(dataDir, "commerce-events.ndjson");
    await writeFile(rotatedPath, `${JSON.stringify(older)}\n${JSON.stringify(boundary)}\n`, { mode: 0o600 });
    await writeFile(currentPath, `${JSON.stringify(recent)}\n`, { mode: 0o600 });
    const before = [sha(await readFile(rotatedPath)), sha(await readFile(currentPath))];
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "migrate-two-file-secret",
      internalToken: TOKEN,
      requestConstructionSince: "2020-01-01T00:00:00.000Z",
    });
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.deepEqual([
      sha(await readFile(rotatedPath)),
      sha(await readFile(currentPath)),
    ], before);
    assert.equal(await fileBytes(telemetry.paths.segmentPaths[2]), null);
    assert.equal(snapshot.requestedWindowComplete, true);
    assert.equal(snapshot.retainedParseableEventCount, 3);
    assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(JSON.stringify(snapshot).includes(boundary.id), false);
  } finally {
    await rm(shapeDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("damaged, missing, oversized, bad, and future segments withhold completeness without rewriting survivors", async () => {
  const shapeDir = await mkdtemp(path.join(os.tmpdir(), "commerce-damage-shape-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-damage-tail-"));
  try {
    const { produced } = await producedBoundary(shapeDir);
    const old = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 26 * HOUR_MS).toISOString() };
    const recent = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 1000).toISOString() };
    const future = { ...produced, id: randomUUID(), ts: new Date(Date.now() + 2 * 24 * HOUR_MS).toISOString() };
    const bad = { ...produced, id: randomUUID(), ts: "2026-02-30T00:00:00.000Z" };
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "damage-tail-secret",
      internalToken: TOKEN,
      retentionSegments: 4,
    });
    const [currentPath, rotatedPath, olderPath] = telemetry.paths.segmentPaths;
    await writeFile(olderPath, `${JSON.stringify(old)}\n`, { mode: 0o600 });
    await writeFile(currentPath, `${JSON.stringify(recent)}\n`, { mode: 0o600 });
    const gapSnapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(gapSnapshot.coverage.prospectiveTail.gap, true);
    assert.equal(gapSnapshot.requestedWindowComplete, false);
    assert.equal(gapSnapshot.coverage.integrity.status, COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT);
    assert.equal(gapSnapshot.retainedParseableEventCount, 2);
    await writeFile(rotatedPath, `${JSON.stringify(old)}\nnot-json\n`, { mode: 0o600 });
    const damagedBefore = sha(await readFile(rotatedPath));
    const damaged = await telemetry.snapshot({ days: 1 });
    assert.equal(sha(await readFile(rotatedPath)), damagedBefore);
    assert.equal(damaged.integrityStatus, COMMERCE_INTEGRITY_UNUSABLE_RECORDS);
    assert.equal(damaged.requestedWindowComplete, false);
    assert.equal(damaged.coverage.integrity.rotatedFile.unusableRecordCount, 1);
    await writeFile(rotatedPath, `${JSON.stringify(future)}\n`, { mode: 0o600 });
    const futureBefore = sha(await readFile(rotatedPath));
    const drifted = await telemetry.snapshot({ days: 1 });
    assert.equal(sha(await readFile(rotatedPath)), futureBefore);
    assert.equal(drifted.coverage.integrity.status, COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT);
    assert.equal(drifted.coverage.integrity.futureRecordCount, 1);
    assert.equal(drifted.requestedWindowComplete, false);
    assert.equal(JSON.stringify(drifted).includes(future.ts), false);
    await writeFile(rotatedPath, `${JSON.stringify(bad)}\n`, { mode: 0o600 });
    const invalid = await telemetry.snapshot({ days: 1 });
    assert.equal(invalid.integrityStatus, COMMERCE_INTEGRITY_UNUSABLE_RECORDS);
    assert.equal(invalid.requestedWindowComplete, false);
    await writeFile(rotatedPath, `${JSON.stringify(old)}\n`, { mode: 0o600 });
    const hugePath = olderPath;
    await writeFile(hugePath, Buffer.alloc(64 * 1024, 0x61), { mode: 0o600 });
    const oversized = await createCommerceTelemetry({
      dataDir,
      secret: "damage-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1024,
      retentionSegments: 4,
    }).snapshot({ days: 1 });
    assert.equal(oversized.coverage.prospectiveTail.capacityWithheld, true);
    assert.equal(oversized.requestedWindowComplete, false);
    assert.equal(oversized.coverage.integrity.status, COMMERCE_INTEGRITY_SOURCE_LOCAL_DRIFT);
    assert.equal((await readFile(hugePath)).length, 64 * 1024);
  } finally {
    await rm(shapeDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("authenticated cuts survive in-capacity rotation once and are lost rather than duplicated past capacity", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-cut-tail-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "cut-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      retentionSegments: 4,
    });
    const cut = signedCut(TOKEN);
    await telemetry.persistJournalCut(cut);
    emit(telemetry, { ip: "203.0.113.71" });
    emit(telemetry, { ip: "203.0.113.72" });
    await telemetry.flush();
    const stored = [];
    for (const filePath of telemetry.paths.segmentPaths) {
      const bytes = await fileBytes(filePath);
      if (!bytes) continue;
      for (const line of bytes.toString("utf8").split("\n")) {
        if (!line.includes(cut.cutId)) continue;
        stored.push(JSON.parse(line));
      }
    }
    assert.equal(stored.length, 1);
    assert.equal(authenticateJournalCut(stored[0], TOKEN), true);
    stored[0].authentication = "ab".repeat(32);
    assert.equal(authenticateJournalCut(stored[0], TOKEN), false);
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
    assert.equal(JSON.stringify(snapshot).includes(cut.cutId), false);
    const storage = await telemetry.storageStatus();
    assert.equal(storage.ready, true);
    assert.equal(typeof storage.currentBytes, "number");
    assert.equal(typeof storage.rotatedBytes, "number");
    assert.equal(typeof storage.paidEvidenceBytes, "number");
    assert.equal(typeof storage.rareFunnelBytes, "number");
    assert.equal(typeof storage.rareFunnelRotatedBytes, "number");
    assert.equal(storage.boundedBytes, 4);
    assert.equal(storage.writerGate.crossProcessSafe, false);
    assert.equal(storage.writerGate.configuredProcesses, 1);
    assert.equal(storage.prospectiveTail.schemaVersion, COMMERCE_PROSPECTIVE_TAIL_SCHEMA);
    for (let index = 0; index < 4; index += 1) emit(telemetry, { ip: `203.0.113.${80 + index}` });
    await telemetry.flush();
    const after = await countId(dataDir, telemetry, cut.cutId);
    assert.equal(after.found, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("unsafe segment nodes and foreign files are refused or left untouched", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-unsafe-tail-"));
  try {
    const sentinel = path.join(dataDir, "sentinel.txt");
    await writeFile(sentinel, "do-not-follow\n", { mode: 0o600 });
    const foreign = path.join(dataDir, "commerce-events.extra.ndjson");
    const notes = path.join(dataDir, "notes.txt");
    await writeFile(foreign, "foreign-segment\n", { mode: 0o600 });
    await writeFile(notes, "foreign-note\n", { mode: 0o600 });
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "unsafe-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      retentionSegments: 4,
    });
    const current = telemetry.paths.currentPath;
    await writeFile(current, "already-there\n", { mode: 0o600 });
    await symlink(sentinel, telemetry.paths.segmentPaths[3]);
    emit(telemetry, { ip: "203.0.113.91" });
    await assert.rejects(() => telemetry.flush(), /unsafe commerce journal file/);
    assert.equal(await readFile(current, "utf8"), "already-there\n");
    assert.equal(await readFile(sentinel, "utf8"), "do-not-follow\n");
    assert.equal((await lstat(telemetry.paths.segmentPaths[3])).isSymbolicLink(), true);
    await rm(telemetry.paths.segmentPaths[3]);
    await rm(current);
    await symlink(sentinel, current);
    const linked = createCommerceTelemetry({
      dataDir,
      secret: "unsafe-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1024,
    });
    emit(linked, { ip: "203.0.113.92" });
    await assert.rejects(() => linked.flush(), /unsafe commerce journal file/);
    assert.equal(await readFile(sentinel, "utf8"), "do-not-follow\n");
    const missed = await linked.snapshot({ days: 1 });
    assert.equal(missed.coverage.prospectiveTail.unsafeSegment, true);
    assert.equal(missed.requestedWindowComplete, false);
    assert.equal(JSON.stringify(missed).includes("do-not-follow"), false);
    await rm(current);
    const fifo = current;
    const made = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    const piped = createCommerceTelemetry({ dataDir, secret: "unsafe-tail-secret", maxBytes: 1024 });
    emit(piped, { ip: "203.0.113.93" });
    await assert.rejects(() => piped.flush(), /unsafe commerce journal file/);
    assert.equal((await lstat(fifo)).isFIFO(), true);
    await rm(fifo);
    const real = path.join(dataDir, "hard-target.ndjson");
    await writeFile(real, "hardlink-body\n", { mode: 0o600 });
    await link(real, current);
    const hard = createCommerceTelemetry({ dataDir, secret: "unsafe-tail-secret", maxBytes: 1024 });
    emit(hard, { ip: "203.0.113.94" });
    await assert.rejects(() => hard.flush(), /unsafe commerce journal file/);
    assert.equal(await readFile(real, "utf8"), "hardlink-body\n");
    assert.equal(await readFile(foreign, "utf8"), "foreign-segment\n");
    assert.equal(await readFile(notes, "utf8"), "foreign-note\n");
    await rm(current);
    const clean = createCommerceTelemetry({
      dataDir,
      secret: "unsafe-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      retentionSegments: 4,
    });
    for (let index = 0; index < 6; index += 1) emit(clean, { ip: `203.0.113.${100 + index}` });
    await clean.flush();
    assert.equal(await readFile(foreign, "utf8"), "foreign-segment\n");
    assert.equal(await readFile(notes, "utf8"), "foreign-note\n");
    assert.equal(await readFile(sentinel, "utf8"), "do-not-follow\n");
    const names = await readdir(dataDir);
    assert.equal(names.includes("commerce-events.extra.ndjson"), true);
    assert.equal(names.includes("notes.txt"), true);
    assert.equal(names.some((name) => name.startsWith("commerce-events.") && name.endsWith(".ndjson") && !telemetry.paths.segmentPaths.some((filePath) => filePath.endsWith(name)) && name !== "commerce-events.extra.ndjson"), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("age expiry drops only a segment proved entirely older, and a snapshot does not delete it", async () => {
  const shapeDir = await mkdtemp(path.join(os.tmpdir(), "commerce-age-shape-"));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-age-tail-"));
  try {
    const { produced } = await producedBoundary(shapeDir);
    const old = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 3 * HOUR_MS).toISOString() };
    const recent = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 1000).toISOString() };
    const mixed = { ...produced, id: randomUUID(), ts: new Date(Date.now() - 5 * HOUR_MS).toISOString() };
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "age-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1,
      maxAgeMs: 60 * 1000,
      retentionSegments: 4,
    });
    await writeFile(telemetry.paths.segmentPaths[1], `${JSON.stringify(old)}\n`, { mode: 0o600 });
    await writeFile(telemetry.paths.currentPath, `${JSON.stringify(recent)}\n`, { mode: 0o600 });
    const oldDigest = sha(await readFile(telemetry.paths.segmentPaths[1]));
    const preview = await telemetry.snapshot({ days: 1 });
    assert.equal(sha(await readFile(telemetry.paths.segmentPaths[1])), oldDigest);
    assert.ok(preview.retainedParseableEventCount >= 2);
    emit(telemetry, { ip: "203.0.113.110" });
    await telemetry.flush();
    assert.equal(await countId(dataDir, telemetry, old.id).then((value) => value.found), 0);
    assert.equal((await countId(dataDir, telemetry, recent.id)).found, 1);
    await writeFile(telemetry.paths.segmentPaths[1], `${JSON.stringify(mixed)}\n${JSON.stringify(recent)}\n`, { mode: 0o600 });
    const mixedDigest = sha(await readFile(telemetry.paths.segmentPaths[1]));
    emit(telemetry, { ip: "203.0.113.111" });
    await telemetry.flush();
    const surviving = await countId(dataDir, telemetry, mixed.id);
    assert.equal(surviving.found, 1);
    const still = await Promise.all(telemetry.paths.segmentPaths.map((filePath) => fileBytes(filePath)));
    assert.equal(still.some((bytes) => bytes && sha(bytes) === mixedDigest), true);
  } finally {
    await rm(shapeDir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("concurrent writes and capture stay on the admission queue and parse as whole rows", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-concurrent-tail-"));
  try {
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "concurrent-tail-secret",
      internalToken: TOKEN,
      maxBytes: 1024 * 1024,
      retentionSegments: 4,
    });
    const capture = telemetry.withJournalCapture(async () => readFile(telemetry.paths.currentPath, "utf8").catch(() => ""));
    const writes = [];
    for (let index = 0; index < 40; index += 1) {
      writes.push(Promise.resolve().then(() => emit(telemetry, { ip: `203.0.113.${index % 50}` })));
    }
    await Promise.all([...writes, capture]);
    await telemetry.flush();
    const seen = new Set();
    let rows = 0;
    for (const filePath of telemetry.paths.segmentPaths) {
      const bytes = await fileBytes(filePath);
      if (!bytes || bytes.length === 0) continue;
      assert.equal(bytes[bytes.length - 1], 10);
      for (const line of bytes.toString("utf8").split("\n")) {
        if (!line) continue;
        const parsed = JSON.parse(line);
        assert.equal(seen.has(parsed.id), false);
        seen.add(parsed.id);
        rows += 1;
      }
    }
    assert.equal(rows, 40);
    const snapshot = await telemetry.snapshot({ days: 1 });
    assert.equal(snapshot.retainedParseableEventCount, 40);
    assert.equal(snapshot.integrityStatus, COMMERCE_INTEGRITY_OK);
    const storage = await telemetry.storageStatus();
    assert.equal(storage.ready, true);
    assert.ok(storage.currentBytes > 0);
    assert.equal(storage.prospectiveTail.occupiedSegments >= 1, true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("measured producer load stays inside the prospective byte cap", async () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { readFileSync } from "node:fs";
    import { mkdtemp, rm, stat } from "node:fs/promises";
    import os from "node:os";
    import path from "node:path";
    import { createCommerceTelemetry } from ${EVENTS_MODULE};
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "commerce-prospective-measure-"));
    const count = 400;
    const telemetry = createCommerceTelemetry({
      dataDir,
      secret: "measure-tail-secret",
      internalToken: ${JSON.stringify(TOKEN)},
      requestConstructionSince: "2020-01-01T00:00:00.000Z",
    });
    const listenersFor = () => {
      const listeners = new Map();
      return {
        once(name, listener) { listeners.set(name, listener); },
        getHeader() { return undefined; },
        finish() { listeners.get("finish")?.(); },
      };
    };
    const writeStart = process.hrtime.bigint();
    for (let index = 0; index < count; index += 1) {
      const res = listenersFor();
      telemetry.middleware({
        path: "/openapi.json",
        url: "/openapi.json",
        method: "GET",
        headers: { "user-agent": "Agent402/1.0" },
        query: {},
        ip: "203.0.113.10",
        socket: {},
      }, { statusCode: 200, once: res.once, getHeader: res.getHeader }, () => {});
      res.finish();
    }
    await telemetry.flush();
    const writeNs = process.hrtime.bigint() - writeStart;
    const snapStart = process.hrtime.bigint();
    const snapshot = await telemetry.snapshot({ days: 1 });
    const snapNs = process.hrtime.bigint() - snapStart;
    let disk = 0;
    let files = 0;
    for (const filePath of telemetry.paths.segmentPaths) {
      const size = await stat(filePath).then((entry) => entry.size).catch(() => 0);
      if (size > 0) files += 1;
      disk += size;
    }
    const hwm = Number((readFileSync("/proc/self/status", "utf8").match(/VmHWM:\\s+(\\d+)/) || [])[1] || 0);
    const sample = (await import("node:fs/promises")).readFile(telemetry.paths.currentPath, "utf8");
    const line = (await sample).trim().split("\\n")[0];
    process.stdout.write(JSON.stringify({
      count,
      retained: snapshot.retainedParseableEventCount,
      complete: snapshot.requestedWindowComplete,
      disk,
      files,
      lineBytes: Buffer.byteLength(line),
      writeMs: Number(writeNs / 1000000n),
      snapMs: Number(snapNs / 1000000n),
      hwmKb: hwm,
      boundedBytes: (await telemetry.storageStatus()).boundedBytes,
    }));
    await rm(dataDir, { recursive: true, force: true });
  `], {
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
  const measured = JSON.parse(child.stdout);
  console.log(`PROSPECTIVE_MEASUREMENT ${JSON.stringify(measured)}`);
  assert.equal(measured.count, 400);
  assert.equal(measured.retained, 400);
  assert.equal(measured.disk <= measured.boundedBytes, true);
  assert.ok(measured.lineBytes > 200 && measured.lineBytes < 8000);
  assert.ok(measured.writeMs < 60000);
  assert.ok(measured.snapMs < 5000);
  assert.ok(measured.hwmKb > 0 && measured.hwmKb < 512 * 1024);
});
