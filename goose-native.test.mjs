import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const GOOSE_ROOT = join(REPO_ROOT, "goose");
const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const GOOSE_FILES = [
  "README.md",
  "INSTALL.txt",
  "goose.config.yaml",
  "goose.config.isolated.yaml",
  "goose.config.with-declared-source.yaml",
  "goose.deeplink.txt",
  "session-flag.txt",
  "extract.recipe.yaml",
  "extract.workflow.md",
];

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

test("goose companion directory ships only public config and docs", () => {
  assert.equal(isDir(GOOSE_ROOT), true);
  const files = walkFiles(GOOSE_ROOT).map((file) => relative(GOOSE_ROOT, file).split(sep).join("/")).sort();
  assert.deepEqual(files, [...GOOSE_FILES].sort());
  assert.equal(isDir(join(GOOSE_ROOT, "bin")), false);
  assert.equal(isDir(join(GOOSE_ROOT, "fixtures")), false);
  assert.equal(isDir(join(GOOSE_ROOT, "src")), false);
  assert.equal(isFile(join(GOOSE_ROOT, "install.mjs")), false);
  assert.equal(isFile(join(GOOSE_ROOT, "RESULT.md")), false);
});

test("default Goose YAML keeps live merchant URL and empty headers", () => {
  const mergeSafe = readUtf8(join(GOOSE_ROOT, "goose.config.yaml"));
  const isolated = readUtf8(join(GOOSE_ROOT, "goose.config.isolated.yaml"));
  for (const text of [mergeSafe, isolated]) {
    assert.match(text, /type: streamable_http/);
    assert.match(text, /uri: "https:\/\/agents\.samedaydesk\.com\/mcp"/);
    assert.match(text, /headers: \{\}/);
    assert.doesNotMatch(text, /X-SameDayDesk-Agent-Source/);
    assert.doesNotMatch(text, /OPENAI_API_KEY:|PRIVATE_KEY:|0x[a-fA-F0-9]{64}/);
  }
  assert.match(isolated, /name: developer\n    enabled: false/);
  assert.doesNotMatch(mergeSafe, /name: developer/);
});

test("optional declared-source YAML is not default and does not claim merchant attribution", () => {
  const optional = readUtf8(join(GOOSE_ROOT, "goose.config.with-declared-source.yaml"));
  assert.match(optional, /X-SameDayDesk-Agent-Source: goose-native-v1/);
  assert.match(optional, /not merchant-allowlisted/);
  assert.match(optional, /do not claim merchant attribution/i);
  assert.match(optional, /Do not use this file as the default install/);
  const install = readUtf8(join(GOOSE_ROOT, "INSTALL.txt"));
  const readme = readUtf8(join(GOOSE_ROOT, "README.md"));
  for (const text of [install, readme]) {
    assert.match(text, /goose\.config\.isolated\.yaml/);
    assert.doesNotMatch(text, /cp goose\/goose\.config\.with-declared-source\.yaml/);
    assert.match(text, /not\s+merchant-allowlisted/);
  }
});

test("deeplink and session flag stay header-free silent install", () => {
  const deeplink = readUtf8(join(GOOSE_ROOT, "goose.deeplink.txt")).trim();
  assert.equal(deeplink.startsWith("goose://extension?"), true);
  assert.match(deeplink, /url=https%3A%2F%2Fagents\.samedaydesk\.com%2Fmcp/);
  assert.match(deeplink, /type=streamable_http/);
  assert.doesNotMatch(deeplink, /header=/);
  const session = readUtf8(join(GOOSE_ROOT, "session-flag.txt")).trim();
  assert.equal(session, LIVE_MCP_URL);
});

test("recipe pins extract discovery without a wrapper paywall", () => {
  const recipe = readUtf8(join(GOOSE_ROOT, "extract.recipe.yaml"));
  assert.match(recipe, /available_tools:\n      - extract/);
  assert.match(recipe, /not authorization/);
  assert.match(recipe, /uri: "https:\/\/agents\.samedaydesk\.com\/mcp"/);
});

test("docs distinguish goose info, omitted fixture loader, and live 22-tool discovery", () => {
  const readme = readUtf8(join(GOOSE_ROOT, "README.md"));
  const install = readUtf8(join(GOOSE_ROOT, "INSTALL.txt"));
  const workflow = readUtf8(join(GOOSE_ROOT, "extract.workflow.md"));
  for (const text of [readme, install, workflow]) {
    assert.match(text, /goose info -v/);
    assert.match(text, /does not (open the MCP|connect)/i);
    assert.match(text, /22-tool|22 tools/);
    assert.match(text, /fixture MCP loader.{0,40}not (part of this repository|in this repository)/i);
    assert.match(text, /mktemp -d/);
    assert.doesNotMatch(text, /\brm -rf|\brmSync|reinstall|~\/\.config\/goose/);
    assert.doesNotMatch(text, /bin\/c13|node bin\/c13/);
  }
  assert.match(readme, /npm run test:goose-native:live/);
  const rootReadme = readUtf8(join(REPO_ROOT, "README.md"));
  const gooseHeading = rootReadme.indexOf("## Goose native config");
  assert.ok(gooseHeading >= 0, "root README missing Goose native config section");
  const gooseSection = rootReadme.slice(gooseHeading, rootReadme.indexOf("\n## ", gooseHeading + 1));
  assert.match(gooseSection, /goose info -v/);
  assert.match(gooseSection, /fixture MCP loader is not part of this repository/i);
  assert.match(gooseSection, /test:goose-native:live/);
});

test("native profile instructions do not mutate existing Goose homes", () => {
  const install = readUtf8(join(GOOSE_ROOT, "INSTALL.txt"));
  assert.match(install, /Existing Goose profiles are unchanged|existing Goose profiles are unchanged/i);
  assert.match(install, /unset GOOSE_PATH_ROOT/);
  assert.doesNotMatch(install, /GOOSE_PATH_ROOT=\$HOME|~\/\.config\/goose/);
});
