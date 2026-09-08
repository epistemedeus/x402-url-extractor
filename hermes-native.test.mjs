import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const HERMES_ROOT = join(REPO_ROOT, "hermes");
const PLUGIN_SKILLS = join(REPO_ROOT, "plugins", "samedaydesk-x402", "skills");
const HERMES_FILES = [
  "README.md",
  "INSTALL.txt",
  "check-isolated-loader.py",
];
const FORBIDDEN_SUBSTRINGS = [
  "2026-07-28",
  "Mcp-Method",
  "Authorization",
  "X-PAYMENT",
  "PAYMENT-SIGNATURE",
  "Bearer ",
  "api_key",
  "api-key",
];
const SKILL_NAME_PATTERN = /^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readUtf8(path) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("\uFEFF"), false, `${path} must not have a BOM`);
  return text;
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

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
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files.sort();
}

function parseSkill(markdown) {
  assert.ok(markdown.startsWith("---\n"), "SKILL.md must start with YAML frontmatter");
  const end = markdown.indexOf("\n---\n", 4);
  assert.ok(end > 0, "SKILL.md frontmatter must close");
  const frontmatter = markdown.slice(4, end);
  const body = markdown.slice(end + 5);
  const fields = {};
  for (const line of frontmatter.split("\n")) {
    const match = /^(name|description|license):\s*(.*)$/.exec(line);
    assert.ok(match, `unexpected frontmatter line: ${line}`);
    fields[match[1]] = match[2];
  }
  return { fields, body, frontmatter };
}

test("hermes companion directory ships only public install docs and the isolated loader checker", () => {
  assert.equal(isDir(HERMES_ROOT), true);
  const files = walkFiles(HERMES_ROOT).map((file) => relative(HERMES_ROOT, file).split(sep).join("/")).sort();
  assert.deepEqual(files, [...HERMES_FILES].sort());
  assert.equal(isDir(join(HERMES_ROOT, "bin")), false);
  assert.equal(isFile(join(HERMES_ROOT, "install.sh")), false);
  assert.equal(isFile(join(HERMES_ROOT, "RESULT.md")), false);
});

test("INSTALL.txt documents isolated HERMES_HOME drop-in and the project-skill trust gate", () => {
  const install = readUtf8(join(HERMES_ROOT, "INSTALL.txt"));
  const readme = readUtf8(join(HERMES_ROOT, "README.md"));
  for (const text of [install, readme]) {
    assert.match(text, /HERMES_HOME/);
    assert.match(text, /web-extract/);
    assert.match(text, /page-change/);
    assert.match(text, /examples\/customer-x402/);
    assert.match(text, /hermes skills trust/);
    assert.doesNotMatch(text, /\b22 tools\b/);
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      assert.equal(text.includes(needle), false, `hermes docs contain ${needle}`);
    }
  }
  assert.match(install, /check-isolated-loader\.py/);
  assert.match(install, /fresh empty HERMES_HOME/);
  assert.doesNotMatch(install, /cp -R plugins/);
  assert.match(install, /does not install Hermes/);
  assert.match(install, /mutate ~\/\.hermes/);
  assert.match(readme, /do not implement an x402 or MPP signer/);
  assert.match(readme, /discovery, not Hermes-wide payment capability/);
  assert.match(readme, /Model execution and payment execution are separate evidence boundaries/);
});

test("existing portable web-extract skill remains the unchanged batch job", () => {
  const markdown = readUtf8(join(PLUGIN_SKILLS, "web-extract", "SKILL.md"));
  const { fields, body } = parseSkill(markdown);
  assert.equal(fields.name, "web-extract");
  assert.match(fields.name, SKILL_NAME_PATTERN);
  assert.ok(fields.description.length <= 1024);
  assert.match(fields.description, /POST \/extract\/batch/);
  assert.match(body, /https:\/\/agents\.samedaydesk\.com\/extract\/batch/);
  assert.match(body, /customer-x402/);
  assert.match(body, /Do not automatically split/);
  assert.doesNotMatch(body, /Authorization:|X-PAYMENT|Bearer |api[_-]key/i);
});

test("page-change skill is fixture-first, offline, and not a payer", () => {
  const markdown = readUtf8(join(PLUGIN_SKILLS, "page-change", "SKILL.md"));
  const { fields, body } = parseSkill(markdown);
  assert.equal(fields.name, "page-change");
  assert.match(fields.name, SKILL_NAME_PATTERN);
  assert.ok(fields.description.length <= 1024);
  assert.equal(fields.description.slice(0, 57), "Offline compare of two extract-batch JSON field snapshots");
  assert.match(fields.description, /without fetching, paying, retrying, or scheduling/);
  assert.match(body, /fixtures\/page-change\/customer-job\/job\.json/);
  assert.match(body, /npm run page-change -- job/);
  assert.match(body, /npm run page-change -- compare/);
  assert.match(body, /will not run `purchase`/);
  assert.match(body, /Do not schedule a follow-up/);
  assert.match(body, /customer-x402/);
  assert.doesNotMatch(body, /Authorization:|X-PAYMENT|Bearer |api[_-]key/i);
  assert.doesNotMatch(markdown, /allowed-tools/);
  assert.doesNotMatch(markdown, /2026-07-28/);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    assert.equal(markdown.includes(needle), false, `page-change skill contains ${needle}`);
  }
});

test("root README documents Hermes as a third runtime path beside Claude and Goose", () => {
  const readme = readUtf8(join(REPO_ROOT, "README.md"));
  assert.match(readme, /## Hermes Agent skills/);
  assert.match(readme, /hermes\/INSTALL\.txt/);
  assert.match(readme, /plugins\/samedaydesk-x402\/skills/);
  assert.match(readme, /check-isolated-loader\.py/);
  assert.match(readme, /fresh empty throwaway profile/);
  assert.doesNotMatch(readme, /cp -R plugins\/samedaydesk-x402/);
  assert.match(readme, /hermes skills trust/);
  assert.match(readme, /That example does not\nmake Hermes payment-capable/);
  assert.doesNotMatch(readme, /\b22 tools\b/);
  for (const stale of ["recut/", "--branch", "Default master does not", "on this branch"]) {
    assert.equal(readme.includes(stale), false, `repository README contains stale landing copy: ${stale}`);
  }
});
