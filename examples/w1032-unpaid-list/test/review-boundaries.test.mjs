import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(current, entry.name);
      const resolved = resolve(full);
      assert.ok(resolved === root || resolved.startsWith(root + sep), `path escaped root: ${full}`);
      if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${relative(root, full)}`);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

test("write boundary is this example; no wallet, no publish script, no paid client", () => {
  const files = walkFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
  assert.equal(files.some((file) => file.startsWith("..")), false);
  const src = files
    .filter((path) => path.startsWith("src/") || path.startsWith("bin/"))
    .filter((path) => path.endsWith(".mjs"))
    .map((path) => readFileSync(join(ROOT, path), "utf8"))
    .join("\n");
  assert.match(src, /tools\/list/);
  assert.match(src, /initialize/);
  assert.doesNotMatch(src, /from ["']@x402\/fetch["']/);
  assert.doesNotMatch(src, /\bcreateWalletClient\b|\bprivateKeyToAccount\b/);
  assert.doesNotMatch(src, /npm publish/);
  assert.doesNotMatch(src, /PAYMENT-SIGNATURE=/);
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.start, "node bin/cli.mjs");
  assert.equal(pkg.scripts["seeded-failure"], "node bin/cli.mjs --seeded-failure --json");
});

test("README names the three checks and the unpaid stop", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /Cold unpaid list/);
  assert.match(readme, /Seeded failure/);
  assert.match(readme, /--seeded-failure/);
  assert.match(readme, /Not neo/);
  assert.match(readme, /not an MCP Registry, npm, or marketplace publish/i);
  assert.match(readme, /Not a paid `tools\/call`/);
});
