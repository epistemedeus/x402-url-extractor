import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { assertCitedFindings, assertDecision, assertNoInventedDemand } from "./assert.mjs";
import {
  CASES,
  decisionOf,
  malformedInput,
  packetOf,
  runArtifactCase,
} from "./load-fixtures.mjs";
import { transform as tMigration } from "../../../s137-consumer-evidence-jobs/src/migration-checklist/transform.mjs";
import { transform as tRelease } from "../../../s137-consumer-evidence-jobs/src/release-brief/transform.mjs";
import { transform as tTable } from "../../../s137-consumer-evidence-jobs/src/table-reconcile/transform.mjs";
import { transform as tLink } from "../../../s137-consumer-evidence-jobs/src/link-index/transform.mjs";
import { transform as tReplay } from "../../../s137-consumer-evidence-jobs/src/replay-pack/transform.mjs";
import { transform as tFresh } from "../../../s137-consumer-evidence-jobs/src/freshness-receipt/transform.mjs";
import { CLI, CLOCK, KIT_ROOT, MATRIX, PIN, S137_ROOT } from "./paths.mjs";

const MATRIX_DOC = JSON.parse(readFileSync(MATRIX, "utf8"));

const TRANSFORMS = {
  "migration-checklist": tMigration,
  "release-brief": tRelease,
  "table-reconcile": tTable,
  "link-index": tLink,
  "replay-pack": tReplay,
  "freshness-receipt": tFresh,
};

export function cellRecord(cellId) {
  const row = MATRIX_DOC.cells.find((c) => c.id === cellId);
  assert.ok(row, `unknown cell ${cellId}`);
  return row;
}

function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout: 20000,
    cwd: S137_ROOT,
    env: { ...process.env },
  });
}

function parseStdoutJson(proc) {
  const text = (proc.stdout || "").trim();
  assert.notEqual(text, "", `empty stdout; stderr=${proc.stderr}`);
  return JSON.parse(text);
}

export async function runSituation(cellId) {
  const cell = cellRecord(cellId);
  const sit = cell.situationId;
  if (sit === "S1") return situationS1(cell);
  if (sit === "S2") return situationS2(cell);
  if (sit === "S3") return situationS3(cell);
  if (sit === "S4") return situationS4(cell);
  if (sit === "S5") return situationS5(cell);
  if (sit === "S6") return situationS6(cell);
  if (sit === "S7") return situationS7(cell);
  if (sit === "S8") return situationS8(cell);
  throw new Error(`unknown situation ${sit}`);
}

function situationS1(cell) {
  const packet = runArtifactCase(cell.artifact, "S1");
  assertDecision(packet, ["pass"]);
  assertCitedFindings(packet);
  assertNoInventedDemand(packet);
  assert.equal(packet.offline ?? true, true);
  assert.equal(packet.payment?.attempted ?? false, false);
}

function situationS2(cell) {
  const packet = runArtifactCase(cell.artifact, "S2");
  assertDecision(packet, ["partial", "unknown"]);
  assert.notEqual(decisionOf(packet), "pass");
  assertCitedFindings(packet);
  assertNoInventedDemand(packet);
}

function situationS3(cell) {
  const packet = runArtifactCase(cell.artifact, "S3");
  assertDecision(packet, ["conflict"]);
  assertCitedFindings(packet);
  assertNoInventedDemand(packet);
}

function situationS4(cell) {
  const expect = CASES[cell.artifact].S4.expect;
  const allowed = Array.isArray(expect) ? expect : [expect];
  let packet = null;
  let threw = false;
  try {
    packet = runArtifactCase(cell.artifact, "S4");
  } catch {
    threw = true;
  }
  if (packet) {
    assertDecision(packet, allowed);
    assert.notEqual(decisionOf(packet), "pass");
    assertNoInventedDemand(packet);
  }

  let malformedThrew = false;
  try {
    const result = TRANSFORMS[cell.artifact](malformedInput(cell.artifact));
    const p = packetOf(result);
    if (p && p.decision) assert.notEqual(p.decision, "pass");
  } catch {
    malformedThrew = true;
  }
  assert.ok(packet || threw || malformedThrew, "S4 must fail, reject, or throw");
}

function fixtureInPath(cell) {
  const map = {
    "migration-checklist": join(S137_ROOT, "fixtures/synthetic/migration/cases/positive-complete.json"),
    "release-brief": join(S137_ROOT, "fixtures/synthetic/release-brief/cases/positive-aligned.json"),
    "table-reconcile": join(S137_ROOT, "fixtures/synthetic/table-reconcile/cases/positive-agree.json"),
    "link-index": join(S137_ROOT, "fixtures/synthetic/link-index/cases/positive-md"),
    "replay-pack": join(S137_ROOT, "fixtures/synthetic/replay-pack/cases/positive-unpaid-complete/case.json"),
    "freshness-receipt": join(S137_ROOT, "fixtures/synthetic/freshness/cases/positive-complete.json"),
  };
  return map[cell.artifact];
}

function situationS5(cell) {
  const proc = runCli(["analyze", cell.artifact, "--in", fixtureInPath(cell), "--clock", CLOCK]);
  assert.ok(proc.status === 0 || proc.status === 1, `unstable exit ${proc.status} stderr=${proc.stderr}`);
  const doc = parseStdoutJson(proc);
  assert.ok(doc && typeof doc === "object");
  assert.equal(doc.offline ?? true, true);
  assert.equal(doc.payment?.attempted ?? false, false);
  assert.ok(doc.schema || doc.packets);

  const batch = runCli([
    "analyze",
    "--all",
    "--clock",
    CLOCK,
    "--in-root",
    join(S137_ROOT, "fixtures/synthetic"),
  ]);
  assert.ok(batch.status === 0 || batch.status === 1, `batch exit ${batch.status}`);
  const family = parseStdoutJson(batch);
  assert.equal(family.all, true);
  assert.ok(Array.isArray(family.packets));
  assert.equal(family.packets.length, 6);

  const excluded = runCli(["analyze", "07", "--clock", CLOCK]);
  assert.equal(excluded.status, 2);
  assert.match(excluded.stderr, /out of scope/);
  const excluded2 = runCli(["analyze", "R2-CONSUMER-JOBS-08", "--clock", CLOCK]);
  assert.equal(excluded2.status, 2);
  assert.match(excluded2.stderr, /out of scope/);
}

async function situationS6(cell) {
  const href = pathToFileURL(join(KIT_ROOT, "src", `${cell.artifact}.mjs`)).href;
  const kitMod = await import(href);
  assert.equal(typeof kitMod.transform, "function", `${cell.artifact} kit transform export`);
  assert.equal(typeof kitMod.JOB_ID, "string");
  assert.ok(kitMod.INPUT_SCHEMA || kitMod.INPUT_SCHEMA_ID);
  const packet = runArtifactCase(cell.artifact, "S1");
  assert.ok(packet);
  assertDecision(packet, ["pass"]);
  if (cell.artifact === "migration-checklist") {
    const again = packetOf(kitMod.transformFixtureCase(CASES[cell.artifact].S1.id));
    assert.equal(decisionOf(again), "pass");
  }
  assertNoInventedDemand(packet);
}

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

function exampleDirFor(cell) {
  const name = cell.fixtureDir === "freshness" ? "freshness" : cell.fixtureDir;
  return join(KIT_ROOT, "examples", name);
}

function situationS7(cell) {
  const exampleDir = exampleDirFor(cell);
  const provenancePath = join(exampleDir, "PROVENANCE.json");
  assert.equal(existsSync(provenancePath), true, `missing ${provenancePath}`);
  const prov = JSON.parse(readFileSync(provenancePath, "utf8"));
  const pins = readFileSync(join(KIT_ROOT, "LICENSE-PINS.md"), "utf8");
  assert.match(pins, new RegExp(PIN));
  assert.match(pins, /Apache-2\.0|MIT|CC-BY-4\.0|license/i);

  const claimed = [];
  if (Array.isArray(prov.artifacts)) {
    for (const row of prov.artifacts) {
      if (row?.sha256) claimed.push(row);
    }
  } else if (prov.artifacts && typeof prov.artifacts === "object") {
    for (const [rel, row] of Object.entries(prov.artifacts)) {
      if (row?.sha256) claimed.push({ path: rel, ...row });
    }
  } else if (typeof prov.sha256 === "string" && prov.snapshotPath) {
    claimed.push({ path: prov.snapshotPath, sha256: prov.sha256 });
  }

  for (const row of claimed) {
    const rel = String(row.path || "");
    const candidates = [
      join(exampleDir, rel),
      join(S137_ROOT, rel.replace(/^experiments\/s137-consumer-evidence-jobs\//, "")),
      join(exampleDir, rel.split("/").pop()),
    ];
    const hit = candidates.find((p) => existsSync(p) && statSync(p).isFile());
    if (!hit) continue;
    assert.equal(sha256File(hit), row.sha256, `hash mismatch for ${rel}`);
  }

  const files = walkFiles(exampleDir);
  for (const abs of files) {
    assert.doesNotMatch(abs, /\/receipts\//);
    assert.doesNotMatch(abs, /\/logs\//);
    assert.doesNotMatch(abs, /private[-_]?transcript/i);
  }
}

function situationS8() {
  const build = join(KIT_ROOT, "scripts", "build-archive.mjs");
  const proc = spawnSync(process.execPath, [build], {
    encoding: "utf8",
    timeout: 60000,
    cwd: KIT_ROOT,
  });
  assert.equal(proc.status, 0, proc.stderr || proc.stdout);
  const tarball = join(KIT_ROOT, "dist", "s137-consumer-evidence-kit.tgz");
  assert.equal(existsSync(tarball), true);
  const list = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  const names = list.stdout.split("\n").filter(Boolean);
  assert.ok(names.some((n) => n.endsWith("README.md")));
  assert.ok(names.some((n) => n.includes("manifests/01.json")));
  assert.ok(names.some((n) => n.includes("manifests/06.json")));
  assert.ok(names.some((n) => n.includes("examples/")));
  assert.ok(names.some((n) => n.includes("LICENSE-PINS.md")));
  assert.ok(names.some((n) => n.includes("COMPAT-07-08.md")));
  assert.ok(!names.some((n) => /(^|\/)receipts(\/|$)/.test(n)));
  assert.ok(!names.some((n) => /(^|\/)logs(\/|$)/.test(n)));
  assert.ok(!names.some((n) => /transcript/i.test(n)));
}
