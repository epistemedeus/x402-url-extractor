import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CASES,
  EXPORT_ENTRY_CAP,
  HOSTILE_FIXTURES,
  LIFECYCLE_SCRIPTS,
  PACK_ROOT,
  casePath,
  classifySourceBuffer,
  inspectManifestPath,
  packAnalyzerPresent,
  probePackAnalyzer,
  scanHostileInputs,
  toPacketPatch,
  withSpawnGuard,
} from "../cells/c14-hostile/index.mjs";
import { materialize } from "../cells/c14-hostile/materialize.mjs";

const CLOCK = "2026-09-10T12:00:00.000Z";
const CELL = path.join(PACK_ROOT, "cells", "c14-hostile");

materialize();

function trackingIo() {
  const reads = [];
  const realpaths = [];
  return {
    reads,
    realpaths,
    io: {
      readFileSync(p, ...rest) {
        const s = String(p);
        reads.push(s);
        if (s.includes(`${path.sep}etc${path.sep}`) || s.endsWith(`${path.sep}passwd`) || s.includes("/etc/")) {
          throw new Error(`hostile gate must not read escaped path: ${s}`);
        }
        return fs.readFileSync(p, ...rest);
      },
      lstatSync: fs.lstatSync,
      readdirSync: fs.readdirSync,
      readlinkSync: fs.readlinkSync,
      realpathSync(p) {
        realpaths.push(String(p));
        throw new Error("realpath must not be used on untrusted trees");
      },
    },
  };
}

function scanCase(id, extra = {}) {
  const { io, reads } = trackingIo();
  const result = scanHostileInputs({
    packageRoot: casePath(id),
    clock: CLOCK,
    createdAt: CLOCK,
    label: "fixture",
    evidenceClass: "fixture",
    io,
    ...extra,
  });
  return { result, reads };
}

function kinds(result) {
  return result.findings.map((f) => f.kind);
}

test("provenance files are fixture/synthetic, not live-capture or paid demand", () => {
  const provenance = JSON.parse(fs.readFileSync(path.join(HOSTILE_FIXTURES, "PROVENANCE.json"), "utf8"));
  assert.equal(provenance.label, "fixture");
  assert.equal(provenance.synthetic, true);
  assert.equal(provenance.liveCapture, false);
  assert.equal(provenance.capturedFromLive, false);
  assert.equal(provenance.paidDemand, false);
  const manifest = JSON.parse(fs.readFileSync(path.join(HOSTILE_FIXTURES, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.liveCapture, false);
  assert.equal(manifest.paidDemand, false);
  assert.deepEqual(
    manifest.cases.map((c) => c.id),
    CASES.map((c) => c.id),
  );
});

test("cell gate source never spawns, never realpath-follows, never import()s untrusted files", () => {
  const gate = fs.readFileSync(path.join(CELL, "hostile-gate.mjs"), "utf8");
  assert.equal(gate.includes("node:child_process"), false);
  assert.equal(gate.includes("child_process"), false);
  assert.equal(gate.includes("spawnSync"), false);
  assert.equal(gate.includes("execFile"), false);
  assert.equal(gate.includes("execSync"), false);
  assert.equal(/npm\s+install/.test(gate), false);
  assert.equal(gate.includes("realpathSync"), false);
  assert.equal(gate.includes("writeFileSync"), false);
  assert.equal(gate.includes("write-marker"), false);
  assert.equal(/\bimport\s*\(/.test(gate), false);
});

test("path traversal in manifest fields is invalid, nextAction unknown, /etc not read", () => {
  const { result, reads } = scanCase("path-traversal");
  assert.equal(result.decision, "invalid");
  assert.equal(result.summary.nextAction, "unknown");
  assert.equal(result.summary.actionableChanges.length, 0);
  assert.ok(kinds(result).includes("path_traversal"));
  assert.equal(result.scripts.executed, false);
  assert.equal(result.paidDemand, false);
  assert.equal(result.label, "fixture");
  const reasons = result.findings.filter((f) => f.kind === "path_traversal").map((f) => f.reason);
  assert.ok(reasons.length >= 4, `expected several traversal findings, got ${reasons.join(",")}`);
  assert.ok(
    reads.every((p) => !p.includes(`${path.sep}etc${path.sep}`) && !p.endsWith("passwd")),
  );
});

test("inspectManifestPath rejects absolute, percent-encoded, file URL, and .. escape", () => {
  const root = casePath("path-traversal");
  assert.equal(inspectManifestPath(root, "main", "../../../../../../etc/passwd").ok, false);
  assert.equal(inspectManifestPath(root, "browser", "/etc/passwd").ok, false);
  assert.equal(inspectManifestPath(root, "exports", "file:///etc/passwd").ok, false);
  assert.equal(inspectManifestPath(root, "exports", "..%2F..%2Fetc%2Fpasswd").ok, false);
  assert.equal(inspectManifestPath(root, "bin", "C:\\Windows\\System32\\cmd.exe").ok, false);
  assert.equal(inspectManifestPath(root, "files", "ok.js").ok, true);
});

test("install-scripts are recorded and never executed; marker stays absent", () => {
  const marker = path.join(casePath("install-scripts"), "SCRIPT_RAN.marker");
  try {
    fs.unlinkSync(marker);
  } catch {
    /* absent */
  }
  assert.equal(fs.existsSync(marker), false);
  assert.equal(globalThis.__C14_SCRIPT_RAN, undefined);

  const wrapped = withSpawnGuard(() => scanCase("install-scripts").result);
  const result = wrapped.value;
  assert.equal(result.scripts.executed, false);
  assert.ok(result.scripts.present.includes("preinstall"));
  assert.ok(result.scripts.present.includes("postinstall"));
  assert.ok(kinds(result).includes("lifecycle_scripts_present"));
  assert.equal(result.decision, "unknown");
  assert.equal(result.summary.nextAction, "unknown");
  assert.ok(result.summary.unknownReasons.includes("lifecycle_scripts_present_not_executed"));
  assert.equal(fs.existsSync(marker), false);
  assert.equal(globalThis.__C14_SCRIPT_RAN, undefined);
  assert.equal(wrapped.invocations.length, 0);
  for (const name of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.ok(LIFECYCLE_SCRIPTS.includes(name));
  }
});

test("untrusted tarball is listed with tar only and is not npm-installed", () => {
  const tgz = path.join(casePath("install-scripts"), "untrusted.tgz");
  assert.equal(fs.existsSync(tgz), true);
  const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
  assert.match(listing, /package\/package.json/);
  assert.match(listing, /package\/write-marker.mjs/);
  const marker = path.join(casePath("install-scripts"), "SCRIPT_RAN.marker");
  assert.equal(fs.existsSync(marker), false);
});

test("enormous exports map returns unknown with partial coverage and few file reads", () => {
  const { result, reads } = scanCase("enormous-exports");
  assert.equal(result.decision, "unknown");
  assert.equal(result.summary.nextAction, "unknown");
  assert.ok(kinds(result).includes("exports_map_oversize"));
  const oversize = result.findings.find((f) => f.kind === "exports_map_oversize");
  assert.ok(oversize.entries > EXPORT_ENTRY_CAP);
  assert.equal(oversize.coverage, "partial");
  assert.ok(reads.length < 20, `expected bounded reads, got ${reads.length}: ${reads.join(",")}`);
  assert.ok(
    reads.every((p) => path.basename(p) === "package.json"),
    `oversize exports must not open per-entry sources, reads=${reads.join(",")}`,
  );
});

test("symlink escape is invalid; in-tree symlink is not an escape; target file not read", () => {
  const escapeLink = path.join(casePath("symlink-bomb"), "escape-link");
  const st = fs.lstatSync(escapeLink);
  assert.equal(st.isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(escapeLink), "/etc/passwd");

  const { result, reads } = scanCase("symlink-bomb");
  assert.equal(result.decision, "invalid");
  assert.equal(result.summary.nextAction, "unknown");
  assert.ok(kinds(result).includes("symlink_escape"));
  assert.ok(
    result.findings.some((f) => f.kind === "symlink_internal" && path.basename(f.path) === "in-tree-link"),
  );
  assert.ok(reads.every((p) => !p.includes("passwd") && !p.includes(`${path.sep}etc${path.sep}`)));

  const description = fs.readFileSync(path.join(casePath("symlink-bomb"), "DESCRIPTION.md"), "utf8");
  assert.match(description, /not created/i);
  assert.match(description, /zip bomb/i);
  assert.match(description, /Tar slip/i);
});

test("conflicting lockfiles yield unknown, not action", () => {
  const { result } = scanCase("conflicting-lockfile");
  assert.equal(result.decision, "unknown");
  assert.equal(result.summary.nextAction, "unknown");
  assert.equal(result.summary.actionableChanges.length, 0);
  const disagree = result.findings.filter((f) => f.kind === "lockfile_disagreement");
  assert.ok(disagree.length >= 1);
  assert.equal(disagree[0].name, "hostile-dep");
  const versions = new Set(Object.values(disagree[0].versions));
  assert.ok(versions.has("2.0.0"));
  assert.ok(versions.has("1.5.0"));
  assert.ok(versions.has("2.1.0"));
  assert.ok(result.limitations.includes("lockfile disagreement"));
});

test("binary file declared as source is unknown, not a crash, not a caller defect", () => {
  const { result } = scanCase("binary-source");
  assert.equal(result.decision, "unknown");
  assert.equal(result.summary.nextAction, "unknown");
  assert.ok(kinds(result).includes("binary_source"));
  const finding = result.findings.find((f) => f.kind === "binary_source");
  assert.match(String(finding.rationale), /not a caller defect/i);
  const buf = fs.readFileSync(path.join(casePath("binary-source"), "index.js"));
  const kind = classifySourceBuffer(buf);
  assert.equal(kind.kind, "binary");
  assert.equal(kind.parseable, false);
});

test("every hostile case keeps nextAction unknown and never claims action", () => {
  for (const row of CASES) {
    const { result } = scanCase(row.id);
    assert.equal(result.summary.nextAction, "unknown", row.id);
    assert.notEqual(result.decision, "action", row.id);
    assert.equal(result.scripts.executed, false, row.id);
    assert.equal(result.summary.actionableChanges.length, 0, row.id);
    assert.equal(result.paidDemand, false, row.id);
    for (const kind of row.expect.findingKinds) {
      assert.ok(kinds(result).includes(kind), `${row.id} missing ${kind}: ${kinds(result).join(",")}`);
    }
    assert.equal(result.decision, row.expect.decision, row.id);
    const patch = toPacketPatch(result);
    assert.equal(patch.summary.nextAction, "unknown");
    assert.deepEqual(patch.bindings, []);
  }
});

test("scanHostileInputs does not throw on missing root; returns invalid", () => {
  const result = scanHostileInputs({
    packageRoot: path.join(HOSTILE_FIXTURES, "does-not-exist"),
    clock: CLOCK,
  });
  assert.equal(result.decision, "invalid");
  assert.equal(result.summary.nextAction, "unknown");
});

test("utf8 JS buffer is text; this cell still does not claim parseable JS/TS", () => {
  const kind = classifySourceBuffer(Buffer.from("export const x = 1;\n", "utf8"));
  assert.equal(kind.kind, "text");
  assert.equal(kind.parseable, "unknown");
});

test("optional pack analyzer probe must not run install scripts", { concurrency: 1 }, () => {
  const marker = path.join(casePath("install-scripts"), "SCRIPT_RAN.marker");
  try {
    fs.unlinkSync(marker);
  } catch {
    /* absent */
  }
  const loc = packAnalyzerPresent();
  const probe = probePackAnalyzer({ timeout: 15000 });
  assert.equal(fs.existsSync(marker), false);
  assert.equal(probe.markerExistsAfter, false);
  assert.equal(globalThis.__C14_SCRIPT_RAN, undefined);
  if (!loc.present) {
    assert.equal(probe.skipped, true);
  } else if (probe.runs && probe.runs[0] && probe.runs[0].stdout) {
    try {
      const packet = JSON.parse(probe.runs[0].stdout);
      if (packet && packet.summary) {
        assert.notEqual(packet.summary.nextAction, "action");
      }
    } catch {
      // CLI may print a non-JSON usage or partial packet; marker absence is the contract.
    }
  }
});

test("spawn guard blocks package-manager child_process when a function tries to launch npm", { concurrency: 1 }, () => {
  let threw = false;
  const { invocations } = withSpawnGuard(() => {
    try {
      childProcess.spawnSync("npm", ["install"], { stdio: "ignore" });
    } catch (err) {
      threw = err && err.code === "c14_spawn_blocked";
    }
  });
  assert.equal(threw, true);
  assert.ok(invocations.some((i) => i.packageManager));
});
