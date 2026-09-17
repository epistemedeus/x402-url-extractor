import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = [
  "PAYMENT-SIGNATURE",
  "X-PAYMENT",
  "Authorization:",
  "Bearer ",
  "api_key",
  "api-key",
  "neomorphic-io",
  "crewai skill publish",
  "crewai skill install",
];

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const resolved = resolve(full);
      assert.ok(resolved === root || resolved.startsWith(root + sep), `path escaped root: ${full}`);
      if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${relative(root, full)}`);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        stack.push(full);
      } else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

test("example stays inside examples/crewai-sds-skills-pin and has no payment or registry publish", () => {
  const files = walkFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
  assert.ok(files.includes("bin/cli.mjs"));
  assert.ok(files.includes("python/pin_agent.py"));
  assert.ok(files.includes("README.md"));
  assert.ok(files.includes("fixtures/seeded-failure/digest-mismatch.json"));
  const scanned = files.filter((file) => !file.startsWith("test/"));
  for (const file of scanned) {
    assert.equal(file.includes(".."), false, file);
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const needle of FORBIDDEN) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});

test("README advertises the cold-run entry and the seeded failure", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /node bin\/cli\.mjs/);
  assert.match(readme, /npm start/);
  assert.match(readme, /--seeded-failure/);
  assert.match(readme, /Agent\.skills/);
  assert.match(readme, /digest/);
  assert.doesNotMatch(readme, /crewai skill publish/);
  assert.match(readme, /Not in this example/);
});

test("python companion is stdlib-only and refuses the seeded digest mismatch", () => {
  const py = join(ROOT, "python/pin_agent.py");
  assert.equal(statSync(py).isFile(), true);
  const ok = spawnSync("python3", [py], { cwd: ROOT, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.boundary.crewaiImport, false);
  assert.equal(report.agent.skills.length, 1);

  const fail = spawnSync("python3", [py, "--seeded-failure"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /digest_mismatch: web-extract sha256 /);
});
