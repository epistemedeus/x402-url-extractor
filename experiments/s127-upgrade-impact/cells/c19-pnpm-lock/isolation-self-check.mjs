/**
 * Isolation self-check for c19-pnpm-lock.
 * Confirms: owned-path-only sources, no registry GET, no lifecycle, no paid fields.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzePnpmLock, CELL_ROOT, loadFixture, SCHEMA } from "./pnpm-lock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = join(HERE, "..", "..");
const OWNED = "cells/c19-pnpm-lock";

const SOURCE_FILES = [
  "pnpm-lock.mjs",
  "yaml-subset.mjs",
  "dep-path.mjs",
  "pnpm-lock.test.mjs",
  "isolation-self-check.mjs",
];

function listFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "." || name === "..") continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) listFiles(abs, acc);
    else acc.push(relative(CELL_ROOT, abs).replace(/\\/g, "/"));
  }
  return acc;
}

export function runIsolationSelfCheck() {
  const failures = [];
  const notes = [];

  const relCell = relative(PACK_ROOT, CELL_ROOT).replace(/\\/g, "/");
  if (relCell !== OWNED && !relCell.endsWith(OWNED)) {
    failures.push(`cell root is not owned path: ${relCell}`);
  }

  const files = listFiles(CELL_ROOT);
  const outside = files.filter((f) => f.startsWith(".."));
  if (outside.length) failures.push(`paths escaped cell: ${outside.join(",")}`);

  for (const src of SOURCE_FILES) {
    const text = readFileSync(join(CELL_ROOT, src), "utf8");
    if (/from ["']node:(http|https|net|dgram|tls)["']/.test(text)) {
      failures.push(`${src} imports a network module`);
    }
    if (/npm install|pnpm install|yarn install/.test(text) && src !== "pnpm-lock.test.mjs") {
      notes.push(`${src} mentions install (string only; verify it is not executed)`);
    }
  }

  const library = readFileSync(join(CELL_ROOT, "pnpm-lock.mjs"), "utf8");
  if (!library.includes("spawnSync")) {
    notes.push("pnpm-lock.mjs has no spawnSync (unexpected; CLI self-check uses it)");
  }

  const marker = join(CELL_ROOT, "fixtures/lifecycle-sentinel/SCRIPT_RAN.marker");
  if (existsSync(marker)) failures.push("SCRIPT_RAN.marker exists before parse");

  const cases = [
    "v9-basic",
    "v6-basic",
    "v9-alias-npm",
    "v6-alias-npm",
    "v9-workspace",
    "disagreement-exact-pin",
    "lifecycle-sentinel",
  ];
  const results = {};
  for (const name of cases) {
    const { lockfileText, manifest } = loadFixture(name);
    results[name] = analyzePnpmLock({ lockfileText, manifest, evidenceClass: "fixture" });
  }

  if (existsSync(marker)) failures.push("SCRIPT_RAN.marker created during parse");

  if (results["v9-basic"].ok !== true) failures.push("v9-basic should resolve");
  if (results["disagreement-exact-pin"].decision !== "unknown") {
    failures.push("disagreement-exact-pin should be unknown");
  }
  if (results["lifecycle-sentinel"].ok !== true) failures.push("lifecycle-sentinel should parse");

  for (const [name, row] of Object.entries(results)) {
    if (row.provenance?.paidDemand) failures.push(`${name} claimed paidDemand`);
    if (row.provenance?.liveCapture) failures.push(`${name} claimed live-capture`);
    if (row.provenance?.label !== "fixture") failures.push(`${name} provenance.label is not fixture`);
  }

  const ok = failures.length === 0;
  return {
    schema: SCHEMA,
    isolation: "c19-pnpm-lock",
    ok,
    ownedPath: OWNED,
    filesWrittenUnderCell: files.length,
    network: "none",
    lifecycleScriptsExecuted: false,
    paidDemand: false,
    liveCapture: false,
    failures,
    notes,
    sample: {
      v9ok: results["v9-basic"].ok,
      disagreementDecision: results["disagreement-exact-pin"].decision,
    },
  };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const report = runIsolationSelfCheck();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}
