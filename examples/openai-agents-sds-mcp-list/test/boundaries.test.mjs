import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
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
      assert.ok(resolved === root || resolved.startsWith(root + sep));
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

test("example stays inside unpaid list: no Agent run, no payment client", () => {
  const files = walkFiles(ROOT).filter((path) => /\.(mjs|md|json)$/.test(path));
  const src = files.filter((path) => path.endsWith(".mjs")).map((path) => readFileSync(path, "utf8")).join("\n");
  assert.match(src, /MCPServerStreamableHttp/);
  assert.doesNotMatch(src, /from ["']@openai\/agents["'][\s\S]{0,80}\bAgent\b/);
  assert.doesNotMatch(src, /\bimport\s*\{[^}]*\b(Agent|run|Runner)\b/);
  assert.doesNotMatch(src, /new Agent\(/);
  assert.doesNotMatch(src, /Runner\.run/);
  assert.doesNotMatch(src, /callTool\(/);
  assert.doesNotMatch(src, /neomorphic\.io/);
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.match(readme, /npm start/);
  assert.match(readme, /MCPServerStreamableHttp/);
  assert.match(readme, /--call extract/);
  assert.doesNotMatch(readme, /OPENAI_API_KEY/);
});

test("package pins OpenAI Agents 0.18.0 and does not publish", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.dependencies["@openai/agents"], "0.18.0");
  assert.equal(pkg.dependencies["@modelcontextprotocol/client"], "2.0.0");
  assert.equal(pkg.scripts.start, "node bin/cli.mjs");
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].dependencies["@openai/agents"], "0.18.0");
  const rel = walkFiles(ROOT).map((path) => relative(ROOT, path));
  assert.equal(rel.some((path) => path === "bin/cli.mjs"), true);
});
