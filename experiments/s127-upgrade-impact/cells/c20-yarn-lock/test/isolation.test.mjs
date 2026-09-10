import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CELL_ID, isolationSelfCheck } from "../isolation.mjs";
import { resolveLockfile } from "../overlay.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (...parts) => join(cellRoot, "fixtures", ...parts);

test("isolation self-check: owned path, no network/spawn imports in cell sources", () => {
  const report = isolationSelfCheck();
  assert.equal(report.ok, true, JSON.stringify(report.findings, null, 2));
  assert.equal(report.cell, CELL_ID);
  assert.equal(report.spawn, "none");
  assert.equal(report.network, "none");
  assert.equal(report.packageLifecycle, "never");
  assert.equal(report.paidDemand, false);
  assert.ok(report.root.endsWith(join("cells", "c20-yarn-lock")));
  assert.ok(report.files.includes("parse.mjs"));
  assert.ok(report.files.includes("fixtures/classic-alias/yarn.lock"));
  assert.ok(report.files.includes("fixtures/classic-conflict/yarn.lock"));
});

test("resolveLockfile does not spawn a package manager", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
      import { resolveLockfile } from ${JSON.stringify(join(cellRoot, "overlay.mjs"))};
      import { join } from "node:path";
      const overlay = resolveLockfile({
        input: {
          lockfilePath: ${JSON.stringify(fixture("classic-simple", "yarn.lock"))},
          dep: "demo-widget",
          evidenceClass: "fixture",
        },
      });
      if (overlay.overlay.dependency.resolvedOld !== "1.0.0") process.exit(2);
      `,
    ],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("cell sources stay under owned root", () => {
  const report = isolationSelfCheck({ root: cellRoot });
  for (const rel of report.files) {
    assert.equal(rel.startsWith(".."), false, rel);
  }
});
