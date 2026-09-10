/**
 * Run a c18 fixture case: extract old/new .d.ts surfaces, scan caller .ts
 * usage, bind. Never installs, never runs package scripts.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bindDtsUsage, diffDtsSurfaces } from "./diff.mjs";
import { engineRecord, isDirectRun } from "./engine.mjs";
import { sha256Hex } from "./lib/hash.mjs";
import { posixRel } from "./lib/paths.mjs";
import { extractPackageTypes } from "./types-entry.mjs";
import { analyzeTypeUsage, subpathFromSpecifier } from "./usage.mjs";
import { assertNoScriptRan } from "./isolation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CELL_ROOT = HERE;
export const FIXTURES_ROOT = join(HERE, "fixtures");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const PACKET_SCHEMA = "s127.upgrade-impact.packet.v1";
export const CASE_SCHEMA = "s127.c18.dts-case.v1";

export function fixturePath(...parts) {
  return join(FIXTURES_ROOT, ...parts);
}

export function loadCase(id) {
  const path = fixturePath("cases", `${id}.json`);
  const body = JSON.parse(readFileSync(path, "utf8"));
  return { path, body };
}

export function listCaseIds() {
  const dir = fixturePath("cases");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .sort();
}

export function runCase(id, options = {}) {
  const loaded = loadCase(id);
  const spec = loaded.body;
  const clock = spec.clock || options.clock || CLOCK;
  const label = spec.label || "synthetic";
  const evidenceClass = spec.evidenceClass || "fixture";
  const depName = spec.dependency.name;
  const oldRoot = fixturePath(spec.dependency.oldTree);
  const newRoot = fixturePath(spec.dependency.newTree);
  const callerRoot = fixturePath(spec.caller.root);
  const sourceRoots = (spec.caller.sourceRoots || []).map((p) => fixturePath(p));

  const usage = analyzeTypeUsage(sourceRoots, depName, { clock });
  const subpaths = new Set(["."]);
  for (const ref of usage.references || []) {
    const sub = subpathFromSpecifier(ref.specifier, depName);
    if (sub) subpaths.add(sub);
  }

  const oldSurface = extractPackageTypes(oldRoot, {
    packageName: depName,
    subpaths: [...subpaths],
    label,
    retrievedAt: clock,
  });
  const newSurface = extractPackageTypes(newRoot, {
    packageName: depName,
    subpaths: [...subpaths],
    label,
    retrievedAt: clock,
  });

  const exportDiff = diffDtsSurfaces(oldSurface, newSurface);
  const bound = bindDtsUsage({
    usage,
    exportDiff,
    oldSurface,
    newSurface,
    dependency: spec.dependency,
  });

  const provenance = [
    ...(oldSurface.provenance || []).map((row) => ({
      ...row,
      path: `fixtures/${spec.dependency.oldTree}/${row.path}`,
      label,
    })),
    ...(newSurface.provenance || []).map((row) => ({
      ...row,
      path: `fixtures/${spec.dependency.newTree}/${row.path}`,
      label,
    })),
  ];

  for (const file of usage.filesScanned || []) {
    const abs = join(sourceRoots[0] || callerRoot, file);
    let contentSha256 = null;
    try {
      contentSha256 = sha256Hex(readFileSync(abs));
    } catch {
      contentSha256 = null;
    }
    provenance.push({
      path: `fixtures/${spec.caller.root}/src/${file.includes("/") ? file : file}`,
      retrievedAt: clock,
      contentSha256,
      coverage: "full",
      label,
    });
  }

  const scriptChecks = [
    assertNoScriptRan(oldRoot),
    assertNoScriptRan(newRoot),
    assertNoScriptRan(callerRoot),
  ];

  const limitations = uniqueLimitations([
    ...(bound.limitations || []),
    ...(oldSurface.limitations || []),
    ...(newSurface.limitations || []),
    ...(usage.limitations || []),
    "synthetic fixture; not live-capture; no paid demand",
    "typescript package was not required and is not used as a checker",
  ]);

  const engine = engineRecord({ used: false, kind: "lexer-bounded" });

  const packet = {
    schema: PACKET_SCHEMA,
    createdAt: clock,
    clock,
    caller: {
      manifestPath: spec.caller.manifestPath
        ? `fixtures/${spec.caller.manifestPath}`
        : `fixtures/${spec.caller.root}/package.json`,
      lockfilePath: spec.caller.lockfilePath ? `fixtures/${spec.caller.lockfilePath}` : null,
      sourceRoots: (spec.caller.sourceRoots || []).map((p) => `fixtures/${p}`),
      evidenceClass,
    },
    dependency: {
      name: depName,
      oldVersion: spec.dependency.oldVersion,
      newVersion: spec.dependency.newVersion,
      resolvedOld: spec.dependency.oldVersion,
      resolvedNew: spec.dependency.newVersion,
    },
    provenance,
    usage: {
      references: usage.references,
      dynamicImport: usage.dynamicImport,
      coverage: usage.coverage,
    },
    exportDiff: bound.exportDiff,
    bindings: bound.bindings,
    summary: bound.summary,
    prior: spec.priorPath
      ? { path: spec.priorPath, sha256: null, sequence: 1, immutable: true, correction: null }
      : null,
    limitations,
    engine,
    dts: {
      schema: CASE_SCHEMA,
      caseId: spec.id,
      old: summarizeSurface(oldSurface),
      new: summarizeSurface(newSurface),
      lifecycleScriptsObserved: {
        old: oldSurface.lifecycleScripts || [],
        new: newSurface.lifecycleScripts || [],
      },
      scriptRanMarkers: scriptChecks,
      claimsFullChecker: false,
    },
  };

  const expect = spec.expect || {};
  const checks = evaluateExpect(packet, expect);

  return {
    ok: checks.ok,
    caseId: spec.id,
    packet,
    checks,
    scriptRanAbsent: scriptChecks.every((s) => s.ok),
  };
}

export function runAllCases() {
  const ids = listCaseIds();
  return ids.map((id) => {
    try {
      return runCase(id);
    } catch (error) {
      return {
        ok: false,
        caseId: id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function summarizeSurface(surface) {
  return {
    ok: surface.ok,
    coverage: surface.coverage,
    names: (surface.exports || []).map((row) => row.name).sort(),
    kinds: Object.fromEntries((surface.exports || []).map((row) => [row.name, row.kind])),
    unknownReasons: (surface.unknowns || []).map((u) => u.reason),
    files: surface.files || [],
  };
}

function evaluateExpect(packet, expect) {
  const failures = [];
  if (expect["summary.nextAction"] && packet.summary.nextAction !== expect["summary.nextAction"]) {
    failures.push(
      `summary.nextAction expected ${expect["summary.nextAction"]} got ${packet.summary.nextAction}`,
    );
  }
  if (Array.isArray(expect["exportDiff.removed"])) {
    for (const name of expect["exportDiff.removed"]) {
      if (!packet.exportDiff.removed.includes(name)) {
        failures.push(`exportDiff.removed missing ${name}`);
      }
    }
  }
  if (expect["exportDiff.coverage"] && packet.exportDiff.coverage !== expect["exportDiff.coverage"]) {
    failures.push(
      `exportDiff.coverage expected ${expect["exportDiff.coverage"]} got ${packet.exportDiff.coverage}`,
    );
  }
  if (Array.isArray(expect.bindings)) {
    for (const want of expect.bindings) {
      const got = packet.bindings.find((b) => b.symbol === want.symbol);
      if (!got) {
        failures.push(`binding missing ${want.symbol}`);
        continue;
      }
      for (const key of ["used", "changeKind", "decision"]) {
        if (want[key] !== undefined && got[key] !== want[key]) {
          failures.push(`binding ${want.symbol}.${key} expected ${want[key]} got ${got[key]}`);
        }
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

function uniqueLimitations(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  const ids = args.filter((a) => !a.startsWith("--"));
  const results = ids.length ? ids.map((id) => runCase(id)) : runAllCases();
  if (asJson) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  } else {
    for (const row of results) {
      const status = row.ok ? "PASS" : "FAIL";
      const action = row.packet?.summary?.nextAction;
      process.stdout.write(`${status} ${row.caseId} nextAction=${action}\n`);
      if (!row.ok) {
        const failures = row.checks?.failures || [row.error];
        for (const f of failures || []) process.stdout.write(`  ${f}\n`);
      }
    }
  }
  const failed = results.some((r) => !r.ok);
  process.exitCode = failed ? 1 : 0;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main(process.argv);
}
