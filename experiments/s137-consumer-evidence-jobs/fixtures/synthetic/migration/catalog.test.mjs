import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DECISIONS, EVIDENCE_CLASSES } from "../../../src/packet.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = join(HERE, "../../..");
const REPO_ROOT = join(PACK_ROOT, "../..");
const CLOCK = "2026-09-10T12:00:00.000Z";
const TABLE_HEADER = ["method", "route", "mcpTool", "challengeResource", "availability"];
const PROVENANCE_SKIP = new Set(["PROVENANCE.json", "catalog.test.mjs"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function listFiles(dir, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function splitRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutEnd.split("|").map((c) => c.trim());
}

function parseOpsTable(md) {
  const lines = String(md).split(/\r?\n/);
  const start = lines.findIndex((l) => /^\|\s*method\s*\|\s*route\s*\|/i.test(l));
  if (start < 0) return [];
  const header = splitRow(lines[start]);
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    if (/^\|\s*:?-{3,}/.test(line.trim())) continue;
    const cells = splitRow(line);
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx] || "";
    });
    if (obj.method && obj.route) rows.push(obj);
  }
  return rows;
}

function opKey(op) {
  return `${String(op.method || "").toUpperCase()} ${op.route}`;
}

function loadCase(id) {
  return readJson(join(HERE, "cases", `${id}.json`));
}

function posixRel(abs) {
  return relative(HERE, abs).split(sep).join("/");
}

test("manifest names required kinds and cases", () => {
  const manifest = readJson(join(HERE, "MANIFEST.json"));
  const clock = readFileSync(join(HERE, "CLOCK.txt"), "utf8").trim();
  assert.equal(clock, CLOCK);
  assert.equal(manifest.clock, CLOCK);
  assert.equal(manifest.evidenceClass, "synthetic");
  assert.equal(manifest.jobId, "R2-CONSUMER-JOBS-01");
  assert.equal(manifest.payment.attempted, false);
  assert.equal(manifest.cost.assignmentSpendUsd, 0);
  assert.deepEqual(manifest.tableHeader, TABLE_HEADER);
  for (const kind of ["positive", "negative", "partial", "conflict"]) {
    assert.ok(manifest.requiredKinds.includes(kind), `missing kind ${kind}`);
  }
  const caseFiles = readdirSync(join(HERE, "cases")).filter((n) => n.endsWith(".json")).sort();
  assert.deepEqual(
    caseFiles,
    [...manifest.requiredCaseIds].map((id) => `${id}.json`).sort(),
  );
});

test("source pins still appear in repository files", () => {
  const pins = readJson(join(HERE, "SOURCE-PINS.json"));
  assert.equal(pins.evidenceClass, "synthetic");
  assert.ok(pins.pins.length > 0);
  for (const pin of pins.pins) {
    const abs = join(REPO_ROOT, pin.repoPath);
    assert.ok(existsSync(abs), `missing repoPath ${pin.repoPath}`);
    const body = readFileSync(abs, "utf8");
    assert.ok(
      body.includes(pin.excerpt),
      `excerpt ${pin.id} not found in ${pin.repoPath}`,
    );
    assert.ok(Array.isArray(pin.usedBy) && pin.usedBy.length > 0, pin.id);
  }
});

test("each case is cited, offline, and kind-aligned", () => {
  const manifest = readJson(join(HERE, "MANIFEST.json"));
  const pins = readJson(join(HERE, "SOURCE-PINS.json"));
  const pinIds = new Set(pins.pins.map((p) => p.id));
  const seenKinds = new Set();

  for (const id of manifest.requiredCaseIds) {
    const c = loadCase(id);
    assert.equal(c.id, id);
    assert.equal(c.evidenceClass, "synthetic");
    assert.ok(EVIDENCE_CLASSES.includes(c.evidenceClass));
    assert.equal(c.clock, CLOCK);
    assert.equal(c.jobId, "R2-CONSUMER-JOBS-01");
    assert.equal(c.offline, true);
    assert.equal(c.payment.attempted, false);
    assert.equal(c.cost.assignmentSpendUsd, 0);
    assert.ok(["positive", "negative", "partial", "conflict"].includes(c.kind), c.kind);
    seenKinds.add(c.kind);
    assert.ok(DECISIONS.includes(c.expect.decision), c.expect.decision);
    assert.equal(c.claims.inventsFacts, false);
    assert.equal(c.claims.paidEndpoint, false);
    assert.equal(c.claims.legalAttestation, false);
    assert.equal(c.claims.modelAsOracle, false);
    assert.equal(c.claims.assertsCustomerDemand, false);

    const citeById = new Map(c.citations.map((x) => [x.id, x]));
    assert.equal(citeById.size, c.citations.length, `${id} duplicate citation id`);
    for (const finding of c.expect.findings) {
      assert.ok(finding.citationIds?.length > 0, `${id} ${finding.id} missing citationIds`);
      for (const cid of finding.citationIds) {
        assert.ok(citeById.has(cid), `${id} ${finding.id} unknown citationId ${cid}`);
      }
    }
    for (const pinId of c.sourcePinIds) {
      assert.ok(pinIds.has(pinId), `${id} unknown sourcePin ${pinId}`);
    }

    const missing = new Set(c.missingPaths || []);
    const listed = [
      ...(c.input.oldDocs || []),
      ...(c.input.newDocs || []),
      c.input.operationsInventory,
    ].filter(Boolean);
    for (const ref of listed) {
      const abs = join(HERE, ref.path);
      if (missing.has(ref.path)) {
        assert.equal(existsSync(abs), false, `${id} expected missing ${ref.path}`);
        continue;
      }
      assert.ok(existsSync(abs), `${id} missing ${ref.path}`);
      const cite = citeById.get(ref.id);
      assert.ok(cite, `${id} input ${ref.id} not in citations`);
      assert.equal(cite.path, ref.path);
    }
  }

  for (const kind of ["positive", "negative", "partial", "conflict"]) {
    assert.ok(seenKinds.has(kind), `no case of kind ${kind}`);
  }
});

test("positive tables: inventory ops unchanged; batch added unused", () => {
  const c = loadCase("positive-complete");
  assert.equal(c.expect.decision, "pass");
  const oldOps = parseOpsTable(readFileSync(join(HERE, c.input.oldDocs[0].path), "utf8"));
  const newOps = parseOpsTable(readFileSync(join(HERE, c.input.newDocs[0].path), "utf8"));
  const inv = readJson(join(HERE, c.input.operationsInventory.path));
  assert.ok(Array.isArray(inv.operations) && inv.operations.length === 2);
  const oldMap = new Map(oldOps.map((o) => [opKey(o), o]));
  const newMap = new Map(newOps.map((o) => [opKey(o), o]));
  for (const op of inv.operations) {
    const k = opKey(op);
    assert.ok(oldMap.has(k), `old missing ${k}`);
    assert.ok(newMap.has(k), `new missing ${k}`);
    assert.equal(oldMap.get(k).challengeResource, newMap.get(k).challengeResource);
  }
  const batch = newMap.get("POST /extract/batch");
  assert.ok(batch);
  assert.equal(batch.challengeResource, "https://agents.samedaydesk.com/extract/batch");
  assert.equal(oldMap.has("POST /extract/batch"), false);
  assert.equal(
    inv.operations.some((o) => opKey(o) === "POST /extract/batch"),
    false,
  );
  const changes = new Map(c.expect.findings.map((f) => [opKey(f.operation), f.change]));
  assert.equal(changes.get("GET /extract"), "unchanged");
  assert.equal(changes.get("GET /read"), "unchanged");
  assert.equal(changes.get("POST /extract/batch"), "added");
});

test("negative missing new docs and malformed inventory", () => {
  const missing = loadCase("negative-missing-new-docs");
  assert.equal(missing.expect.decision, "fail");
  assert.equal(existsSync(join(HERE, missing.input.newDocs[0].path)), false);
  assert.equal(missing.expect.findings[0].change, "invalid-input");

  const malformed = loadCase("negative-malformed-inventory");
  assert.equal(malformed.expect.decision, "fail");
  const inv = readJson(join(HERE, malformed.input.operationsInventory.path));
  assert.equal(Array.isArray(inv.operations), false);
  assert.equal(malformed.expect.findings[0].change, "invalid-input");
});

test("partial: inventory extract_batch has no new table row", () => {
  const c = loadCase("partial-batch-undocumented");
  assert.equal(c.expect.decision, "partial");
  const newOps = parseOpsTable(readFileSync(join(HERE, c.input.newDocs[0].path), "utf8"));
  const inv = readJson(join(HERE, c.input.operationsInventory.path));
  assert.ok(inv.operations.some((o) => opKey(o) === "POST /extract/batch"));
  assert.equal(
    newOps.some((o) => opKey(o) === "POST /extract/batch"),
    false,
  );
  const finding = c.expect.findings.find((f) => f.id === "batch-missing-in-new");
  assert.equal(finding.change, "missing-in-new");
  assert.deepEqual(finding.citationIds, ["inventory"]);
});

test("conflict: two new docs disagree on challengeResource", () => {
  const c = loadCase("conflict-challenge-resource");
  assert.equal(c.expect.decision, "conflict");
  const httpOps = parseOpsTable(readFileSync(join(HERE, "docs/conflict-challenge-resource/new-http.md"), "utf8"));
  const mcpOps = parseOpsTable(readFileSync(join(HERE, "docs/conflict-challenge-resource/new-mcp.md"), "utf8"));
  const http = httpOps.find((o) => opKey(o) === "POST /extract/batch");
  const mcp = mcpOps.find((o) => opKey(o) === "POST /extract/batch");
  assert.ok(http && mcp);
  assert.notEqual(http.challengeResource, mcp.challengeResource);
  const finding = c.expect.findings[0];
  assert.equal(finding.change, "conflict");
  assert.ok(finding.values.includes(http.challengeResource));
  assert.ok(finding.values.includes(mcp.challengeResource));
  assert.ok(finding.citationIds.includes("new-http"));
  assert.ok(finding.citationIds.includes("new-mcp"));
});

test("PROVENANCE hashes match authored files", () => {
  const provenance = readJson(join(HERE, "PROVENANCE.json"));
  assert.equal(provenance.evidenceClass, "synthetic");
  assert.equal(provenance.retrievedAt, CLOCK);
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.paidDemand, false);
  assert.ok(provenance.licenseNote);
  const files = listFiles(HERE).filter((abs) => !PROVENANCE_SKIP.has(posixRel(abs).split("/").pop()));
  const listed = new Set(Object.keys(provenance.files));
  for (const abs of files) {
    const rel = posixRel(abs);
    assert.ok(provenance.files[rel], `PROVENANCE missing ${rel}`);
    const rec = provenance.files[rel];
    assert.equal(rec.sha256, sha256(readFileSync(abs)));
    assert.equal(rec.label, "synthetic");
    listed.delete(rel);
  }
  assert.equal(listed.size, 0, `PROVENANCE extra keys ${[...listed].join(",")}`);
});
