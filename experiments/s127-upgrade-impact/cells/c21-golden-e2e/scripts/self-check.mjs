#!/usr/bin/env node
/**
 * Isolation + consistency self-check for c21-golden-e2e.
 * Does not import or spawn the pack CLI. Node built-ins only.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertGoldenDecisions,
  compareToGolden,
  loadGoldenAssertions,
  loadGoldenPacket,
  validatePacket,
  verifyGoldenProvenance,
} from "../lib/assert.mjs";
import { GOLDEN_BINDINGS, PACKET_SCHEMA } from "../lib/contract.mjs";
import { sha256File } from "../lib/hash.mjs";
import { CELL_REL, CELL_ROOT, PACK_ROOT, packRel } from "../lib/paths.mjs";
import { diffNamedExports, scanCallerSource, scanExports } from "../lib/scan-fixture.mjs";

const SKIP_DIR = new Set(["node_modules", ".git"]);
const HOSTILE_MARKERS = ["SCRIPT_RAN.marker", "SENTINEL_SHOULD_NOT_EXIST"];

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name === "." || ent.name === "..") continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR.has(ent.name)) continue;
        stack.push(full);
        continue;
      }
      if (ent.isFile()) out.push(full);
    }
  }
  out.sort();
  return out;
}

function posixRel(from, to) {
  return relative(from, to).split(sep).join("/");
}

function record(errors, warnings, ok, message) {
  if (ok) return;
  errors.push(message);
}

const errors = [];
const warnings = [];
const notes = [];

const packet = loadGoldenPacket();
const assertions = loadGoldenAssertions();

const schemaCheck = validatePacket(packet);
for (const err of schemaCheck.errors) errors.push(`packet schema: ${err}`);
const decisionCheck = assertGoldenDecisions(packet);
for (const err of decisionCheck.errors) errors.push(`golden decisions: ${err}`);
const selfCompare = compareToGolden(packet, packet, { ignoreClock: false });
for (const err of selfCompare.errors) errors.push(`self-compare: ${err}`);
const hashCheck = verifyGoldenProvenance(packet, PACK_ROOT);
for (const err of hashCheck.errors) errors.push(`provenance: ${err}`);

if (packet.schema !== PACKET_SCHEMA) errors.push("packet.schema mismatch");
if (assertions.schema !== "s127.upgrade-impact.golden-assertions.v1") {
  errors.push("assertions.schema mismatch");
}
if (assertions.liveCapture === true || assertions.paidDemand === true) {
  errors.push("assertions must not claim live-capture or paid demand");
}
if (packet.label !== "synthetic") errors.push("packet.label must be synthetic");
if (packet.payment?.attempted === true) errors.push("payment.attempted must be false");

const callerApp = join(CELL_ROOT, "fixtures/caller/src/app.js");
const callerTypes = join(CELL_ROOT, "fixtures/caller/src/types.ts");
const oldIndex = join(CELL_ROOT, "fixtures/packages/s127-golden-kit/1.0.0/index.js");
const oldPlugin = join(CELL_ROOT, "fixtures/packages/s127-golden-kit/1.0.0/plugin.js");
const newIndex = join(CELL_ROOT, "fixtures/packages/s127-golden-kit/2.0.0/index.js");
const newPlugin = join(CELL_ROOT, "fixtures/packages/s127-golden-kit/2.0.0/plugin.js");

for (const path of [callerApp, callerTypes, oldIndex, oldPlugin, newIndex, newPlugin]) {
  if (!existsSync(path)) errors.push(`missing fixture file: ${posixRel(CELL_ROOT, path)}`);
}

const appSrc = readFileSync(callerApp, "utf8");
const typesSrc = readFileSync(callerTypes, "utf8");
const oldMain = scanExports(readFileSync(oldIndex, "utf8"));
const newMain = scanExports(readFileSync(newIndex, "utf8"));
const oldPlug = scanExports(readFileSync(oldPlugin, "utf8"));
const newPlug = scanExports(readFileSync(newPlugin, "utf8"));
const caller = scanCallerSource(appSrc);
const typeScan = scanCallerSource(typesSrc);

const mainDiff = diffNamedExports(oldMain, newMain);
const pluginDiff = diffNamedExports(oldPlug, newPlug);

const expectOldMain = ["format", "keep", "unusedRemoved", "usedRemoved"];
const expectNewMain = ["format", "keep"];
const expectOldPlug = ["dynamicRemoved", "pluginKeep"];
const expectNewPlug = ["pluginKeep"];

if (JSON.stringify(oldMain) !== JSON.stringify(expectOldMain)) {
  errors.push(`old main exports ${JSON.stringify(oldMain)} != ${JSON.stringify(expectOldMain)}`);
}
if (JSON.stringify(newMain) !== JSON.stringify(expectNewMain)) {
  errors.push(`new main exports ${JSON.stringify(newMain)} != ${JSON.stringify(expectNewMain)}`);
}
if (JSON.stringify(oldPlug) !== JSON.stringify(expectOldPlug)) {
  errors.push(`old plugin exports ${JSON.stringify(oldPlug)} != ${JSON.stringify(expectOldPlug)}`);
}
if (JSON.stringify(newPlug) !== JSON.stringify(expectNewPlug)) {
  errors.push(`new plugin exports ${JSON.stringify(newPlug)} != ${JSON.stringify(expectNewPlug)}`);
}

const staticSymbols = caller.staticNamed.map((row) => row.symbol).sort();
if (JSON.stringify(staticSymbols) !== JSON.stringify(["format", "usedRemoved"])) {
  errors.push(`caller static named imports ${JSON.stringify(staticSymbols)} != [format, usedRemoved]`);
}
if (caller.staticNamed.some((row) => row.symbol === "unusedRemoved")) {
  errors.push("caller must not statically import unusedRemoved");
}
if (!caller.dynamicSpecifiers.some((row) => row.specifier === "s127-golden-kit/plugin")) {
  errors.push("caller must dynamically import s127-golden-kit/plugin");
}
if (caller.dynamicSpecifiers.length !== 1) {
  errors.push(`expected one dynamic import, got ${caller.dynamicSpecifiers.length}`);
}
if (!typeScan.typeOnly.some((row) => row.symbol === "FormatOptions")) {
  errors.push("types.ts must contain a type-only FormatOptions import");
}
if (typeScan.staticNamed.length > 0) {
  errors.push("types.ts must not contribute runtime named imports");
}

if (!mainDiff.removed.includes("usedRemoved") || !mainDiff.removed.includes("unusedRemoved")) {
  errors.push(`main exportDiff.removed unexpected: ${JSON.stringify(mainDiff.removed)}`);
}
if (!pluginDiff.removed.includes("dynamicRemoved")) {
  errors.push(`plugin exportDiff.removed unexpected: ${JSON.stringify(pluginDiff.removed)}`);
}

const packetRemoved = [...(packet.exportDiff?.removed || [])].sort();
const scanRemoved = [...mainDiff.removed, ...pluginDiff.removed].sort();
if (JSON.stringify(packetRemoved) !== JSON.stringify(scanRemoved)) {
  errors.push(
    `packet exportDiff.removed ${JSON.stringify(packetRemoved)} != fixture scan ${JSON.stringify(scanRemoved)}`,
  );
}

notes.push("fixture-grammar scan agrees with packet exportDiff.removed and usage named/dynamic rows");
notes.push("types.ts is type-only; labeled unknown; not treated as runtime use");

const cellFiles = walkFiles(CELL_ROOT);
for (const file of cellFiles) {
  const rel = posixRel(CELL_ROOT, file);
  if (rel.split("/").includes("node_modules")) {
    errors.push(`node_modules present: ${rel}`);
  }
  if (HOSTILE_MARKERS.includes(file.split(sep).pop())) {
    errors.push(`hostile marker present: ${rel}`);
  }
}

let gitCellStatus = "";
try {
  gitCellStatus = execFileSync(
    "git",
    ["-C", "/tmp/s127/x402-url-extractor", "status", "--short", "--", "experiments/s127-upgrade-impact/cells/c21-golden-e2e"],
    { encoding: "utf8" },
  ).trim();
} catch (error) {
  warnings.push(`git status unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

for (const file of cellFiles) {
  const rel = posixRel(CELL_ROOT, file);
  if (rel.startsWith("..")) errors.push(`file escaped cell root: ${rel}`);
}

const selfCheckPath = fileURLToPath(import.meta.url);
const selfSource = readFileSync(selfCheckPath, "utf8");
if (selfSource.includes("scripts/cli.mjs") && /import\s+.*cli\.mjs/.test(selfSource)) {
  errors.push("self-check must not import the pack CLI");
}

const libAssert = readFileSync(join(CELL_ROOT, "lib/assert.mjs"), "utf8");
if (/from\s+["'].*scripts\/(cli|lib\/packet)/.test(libAssert)) {
  errors.push("lib/assert.mjs must not import the pack CLI");
}

function mutateBinding(source, symbol, patch) {
  const clone = JSON.parse(JSON.stringify(source));
  const row = (clone.bindings || []).find((item) => item.symbol === symbol);
  if (row) Object.assign(row, patch);
  return clone;
}

const illegalUsed = assertGoldenDecisions(mutateBinding(packet, "usedRemoved", { decision: "no_action" }));
if (illegalUsed.ok) errors.push("assertGoldenDecisions must reject usedRemoved demoted to no_action");
const illegalUnused = assertGoldenDecisions(mutateBinding(packet, "unusedRemoved", { decision: "action" }));
if (illegalUnused.ok) errors.push("assertGoldenDecisions must reject unusedRemoved promoted to action");
const illegalDynamic = assertGoldenDecisions(mutateBinding(packet, "dynamicRemoved", { decision: "action" }));
if (illegalDynamic.ok) errors.push("assertGoldenDecisions must reject dynamicRemoved promoted to action");
notes.push("negative mutations of the three golden triples are rejected");

const isolation = {
  ownedWritePath: CELL_REL,
  packRel: packRel(CELL_ROOT),
  filesWrittenUnderCell: cellFiles.map((file) => posixRel(CELL_ROOT, file)),
  nodeModulesAbsent: !existsSync(join(CELL_ROOT, "node_modules")),
  hostileMarkersAbsent: HOSTILE_MARKERS.every((name) => !cellFiles.some((file) => file.endsWith(name))),
  cliNotImported: true,
  gitStatusOwnedPath: gitCellStatus || "(clean or untracked as a unit)",
  label: "synthetic",
  liveCapture: false,
  paidDemand: false,
};

const receiptDir = join(CELL_ROOT, "receipts");
mkdirSync(receiptDir, { recursive: true });

const receipt = {
  schema: "s127.c21.self-check.v1",
  ok: errors.length === 0,
  clock: packet.clock,
  label: "synthetic",
  liveCapture: false,
  paidDemand: false,
  packetSchema: packet.schema,
  goldenBindings: GOLDEN_BINDINGS,
  errors,
  warnings,
  notes,
  isolation,
  scan: {
    oldMain,
    newMain,
    oldPlugin: oldPlug,
    newPlugin: newPlug,
    mainRemoved: mainDiff.removed,
    pluginRemoved: pluginDiff.removed,
    staticNamed: caller.staticNamed,
    dynamicSpecifiers: caller.dynamicSpecifiers,
    typeOnly: typeScan.typeOnly,
  },
  packetSha256: sha256File(join(CELL_ROOT, "expected/packet.json")),
  cellFileCount: cellFiles.length,
};

writeFileSync(join(receiptDir, "self-check.json"), `${JSON.stringify(receipt, null, 2)}\n`);

if (errors.length) {
  process.stderr.write(`c21 self-check FAILED (${errors.length})\n${errors.map((row) => `- ${row}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `c21 self-check OK\npacket=${PACKET_SCHEMA}\nbindings=${GOLDEN_BINDINGS.map((row) => `${row.symbol}:${row.decision}`).join(",")}\nfiles=${cellFiles.length}\nlabel=synthetic liveCapture=false paidDemand=false\n`,
);
if (warnings.length) process.stdout.write(`warnings:\n${warnings.map((row) => `- ${row}`).join("\n")}\n`);
process.exit(0);
