import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = [
  "--live",
  "OPENAI_API_KEY",
  "sk-",
  "PAYMENT-SIGNATURE",
  "X-PAYMENT",
  "privateKeyToAccount",
  "neo",
  "publish",
];

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "package-lock.json") continue;
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

test("example tree stays inside examples/openai-agents-unpaid-call", () => {
  assert.equal(statSync(ROOT).isDirectory(), true);
  const files = walkFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
  assert.ok(files.includes("bin/cli.mjs"));
  assert.ok(files.includes("src/classify.mjs"));
  assert.ok(files.includes("fixtures/unpaid-call-is-error.json"));
  assert.ok(files.includes("fixtures/hostile/is-error-false.json"));
  assert.equal(files.some((file) => file.startsWith("..")), false);
});

test("source and docs refuse live payment and secrets", () => {
  const files = walkFiles(ROOT).filter((file) => /\.(mjs|md|json)$/.test(file) && !file.includes(`${sep}node_modules${sep}`));
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (rel.startsWith("fixtures/hostile/")) continue;
    if (rel === "package-lock.json") continue;
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("\uFEFF"), false, rel);
    if (rel === "README.md" || rel.endsWith("cli.mjs") || rel.endsWith("constants.mjs")) {
      assert.match(text, /--live/, rel);
    }
    if (rel.endsWith(".mjs") && !rel.startsWith("test/")) {
      assert.doesNotMatch(text, /privateKeyToAccount|signTypedData|PAYMENT-SIGNATURE/, rel);
    }
  }
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  for (const token of ["--live", "--pay", "isError", "callToolResult"]) {
    assert.match(readme, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(readme, /sk-[A-Za-z0-9]{10,}/);
  assert.equal(FORBIDDEN.includes("--live"), true);
});

test("package is private, credential-free, and pins OpenAI Agents", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies["@openai/agents"], "0.18.0");
  assert.equal("viem" in (pkg.dependencies || {}), false);
  assert.equal("@x402/fetch" in (pkg.dependencies || {}), false);
  assert.match(pkg.scripts.start, /bin\/cli\.mjs/);
  assert.match(pkg.scripts.fail, /is-error-false\.json/);
});
