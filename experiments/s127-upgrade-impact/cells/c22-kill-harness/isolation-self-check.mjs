/**
 * Isolation self-check for c22-kill-harness.
 * Confirms writes stay under this cell and sibling/S124/S125 trees are not targets.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { CELL_ID, CELL_ROOT, FORBIDDEN_WRITE_ROOTS, PACK_ROOT, REPO_ROOT, assertWritableOut, isInsideRoot } from "./lib/paths.mjs";

const OWNED_PREFIX = `experiments/s127-upgrade-impact/cells/${CELL_ID}/`;

export function runIsolationSelfCheck() {
  const ownedFiles = listFiles(CELL_ROOT);
  const escaped = ownedFiles.filter((abs) => !isInsideRoot(CELL_ROOT, abs));
  const jailTests = [
    probe("cell-out", join(CELL_ROOT, "fixtures/out/isolation-probe.json"), true, "cell"),
    probe("sibling-c11", join(PACK_ROOT, "cells/c11-real-a/from-c22.json"), false, null),
    probe("sibling-c12", join(PACK_ROOT, "cells/c12-real-b/from-c22.json"), false, null),
    probe("pack-src", join(PACK_ROOT, "src/from-c22.mjs"), false, null),
    probe("real-a-fixtures", join(PACK_ROOT, "fixtures/real-a/from-c22.json"), false, null),
    probe("s124", join(REPO_ROOT, "experiments/s124-marketplace/from-c22.json"), false, null),
    probe("s125", join(REPO_ROOT, "experiments/s125-pulse/from-c22.json"), false, null),
    probe("tmpdir-without-allow", join(tmpdir(), "c22-from-cell.json"), false, null, { allowTmp: false }),
    probe("tmpdir-with-allow", join(tmpdir(), "c22-from-cell.json"), true, "tmpdir", { allowTmp: true }),
  ];

  const forbiddenExisting = FORBIDDEN_WRITE_ROOTS.map((root) => ({
    root,
    exists: existsSync(root),
  }));

  const failedJail = jailTests.filter((row) => !row.ok);
  const ok = escaped.length === 0 && failedJail.length === 0;

  return {
    schema: "s127.upgrade-impact.kill-isolation.v1",
    ok,
    cellId: CELL_ID,
    cellRoot: CELL_ROOT,
    ownedPrefix: OWNED_PREFIX,
    ownedFileCount: ownedFiles.length,
    escapedWrites: escaped.map((abs) => relative(CELL_ROOT, abs)),
    jailTests,
    forbiddenWriteRoots: forbiddenExisting,
    notes: [
      "This cell writes only under cells/c22-kill-harness/.",
      "S124 marketplace and S125 Pulse trees are forbidden write roots.",
      "c11-real-a, c12-real-b, fixtures/real-a, fixtures/real-b, pack src/scripts are not owned.",
      "No npm install. No lifecycle scripts. No payment.",
    ],
    payment: { attempted: false },
  };
}

function probe(id, path, expectOk, expectZone, options = {}) {
  const result = assertWritableOut(path, options);
  const matched = result.ok === expectOk && (expectOk ? result.zone === expectZone : true);
  return {
    id,
    path,
    expectOk,
    actualOk: result.ok,
    actualCode: result.code || null,
    actualZone: result.zone || null,
    ok: matched,
  };
}

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() || statSync(abs).isFile()) out.push(abs);
    }
  };
  walk(root);
  return out;
}

export function isolationMain() {
  return runIsolationSelfCheck();
}
