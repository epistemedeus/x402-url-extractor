import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import Ajv from "ajv";
import {
  assertPublicHttpsUrl, extractBatchInputSchema, normalizeExtractBatchInput,
  canonicalExtractBatchBody,
} from "./extract-batch.mjs";

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
  "record.recipe.yaml",
  "record.workflow.md",
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

test("optional declared-source YAML is not default and does not claim identity", () => {
  const optional = readUtf8(join(GOOSE_ROOT, "goose.config.with-declared-source.yaml"));
  assert.match(optional, /X-SameDayDesk-Agent-Source: goose-native-v1/);
  assert.match(optional, /attribution-only|caller-declared/i);
  assert.doesNotMatch(optional, /not merchant-allowlisted/);
  assert.match(optional, /Do not use this file as the default install/);
  const install = readUtf8(join(GOOSE_ROOT, "INSTALL.txt"));
  const readme = readUtf8(join(GOOSE_ROOT, "README.md"));
  for (const text of [install, readme]) {
    assert.match(text, /goose\.config\.isolated\.yaml/);
    assert.doesNotMatch(text, /cp goose\/goose\.config\.with-declared-source\.yaml/);
    assert.doesNotMatch(text, /not\s+merchant-allowlisted/);
  }
  const telemetry = readUtf8(join(REPO_ROOT, "commerce-events.mjs"));
  assert.match(telemetry, /\["goose-native-v1", "goose-native"\]/);
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

test("recipe pins extract and extract_batch discovery without a wrapper paywall", () => {
  const recipe = readUtf8(join(GOOSE_ROOT, "extract.recipe.yaml"));
  assert.match(recipe, /available_tools:\n      - extract\n      - extract_batch/);
  assert.match(recipe, /not authorization/);
  assert.match(recipe, /uri: "https:\/\/agents\.samedaydesk\.com\/mcp"/);
});

test("record recipe is offline CLI mapping and does not attach paid extract tools", () => {
  const recipe = readUtf8(join(GOOSE_ROOT, "record.recipe.yaml"));
  const workflow = readUtf8(join(GOOSE_ROOT, "record.workflow.md"));
  assert.match(recipe, /title: SameDayDesk explicit record mapping/);
  assert.match(recipe, /Do not fetch, pay, infer entities/);
  assert.match(recipe, /npm run record/);
  assert.match(recipe, /node bin\/record\.mjs/);
  assert.doesNotMatch(recipe, /available_tools:/);
  assert.doesNotMatch(recipe, /type: streamable_http/);
  assert.doesNotMatch(recipe, /uri: "https:\/\/agents\.samedaydesk\.com\/mcp"/);
  assert.match(recipe, /Do not call extract, extract_batch, or purchase/);
  assert.match(recipe, /charged true is not useful-output proof/);
  assert.match(workflow, /goose recipe validate goose\/record\.recipe\.yaml/);
  assert.match(workflow, /mktemp -d/);
  assert.match(workflow, /fixtures\/record\/product-jsonld/);
  assert.match(workflow, /fixtures\/record\/org-contact/);
  assert.match(workflow, /If `goose` is not installed, record that exact limit/);
  assert.doesNotMatch(workflow, /\brm -rf|\brmSync|reinstall|~\/\.config\/goose/);
});

test("docs distinguish goose info, omitted fixture loader, and live inventory discovery", () => {
  const readme = readUtf8(join(GOOSE_ROOT, "README.md"));
  const install = readUtf8(join(GOOSE_ROOT, "INSTALL.txt"));
  const workflow = readUtf8(join(GOOSE_ROOT, "extract.workflow.md"));
  for (const text of [readme, install, workflow]) {
    assert.match(text, /goose info -v/);
    assert.match(text, /does not (open the MCP|connect)/i);
    assert.match(text, /extract_batch/);
    assert.match(text, /fixture MCP loader.{0,40}not (part of this repository|in this repository)/i);
    assert.match(text, /mktemp -d/);
    assert.doesNotMatch(text, /\brm -rf|\brmSync|reinstall|~\/\.config\/goose/);
    assert.doesNotMatch(text, /bin\/c13|node bin\/c13/);
    assert.doesNotMatch(text, /\b22 tools\b|\b22-tool\b/);
  }
  assert.match(readme, /npm run test:goose-native:live/);
  const rootReadme = readUtf8(join(REPO_ROOT, "README.md"));
  const gooseHeading = rootReadme.indexOf("## Goose native config");
  assert.ok(gooseHeading >= 0, "root README missing Goose native config section");
  const gooseSection = rootReadme.slice(gooseHeading, rootReadme.indexOf("\n## ", gooseHeading + 1));
  assert.match(gooseSection, /goose info -v/);
  assert.match(gooseSection, /fixture MCP loader is not part of this repository/i);
  assert.match(gooseSection, /test:goose-native:live/);
  assert.match(gooseSection, /extract_batch/);
  assert.doesNotMatch(gooseSection, /\b22 tools\b/);
});

test("native profile instructions do not mutate existing Goose homes", () => {
  const install = readUtf8(join(GOOSE_ROOT, "INSTALL.txt"));
  assert.match(install, /Existing Goose profiles are unchanged|existing Goose profiles are unchanged/i);
  assert.match(install, /unset GOOSE_PATH_ROOT/);
  assert.doesNotMatch(install, /GOOSE_PATH_ROOT=\$HOME|~\/\.config\/goose/);
});

// Mechanical construction only: these tests do not evaluate a model, prove
// installation, choose a route on a buyer's behalf, or confer payment authority.
test("three caller URLs and fields construct a schema-valid unpaid POST", async () => {
  const input = {
    urls: ["https://example.com/", "https://example.org/", "https://www.rfc-editor.org/rfc/rfc3986"],
    fields: ["title", "description", "headings"],
  };
  const body = canonicalExtractBatchBody(normalizeExtractBatchInput(input));
  const request = new Request("https://agents.samedaydesk.com/extract/batch", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://agents.samedaydesk.com/extract/batch");
  assert.deepEqual([...request.headers], [["content-type", "application/json"]]);
  const sent = await request.json();
  assert.deepEqual(sent, input);
  const validate = new Ajv({ strict: false, formats: { uri: true } }).compile(extractBatchInputSchema());
  assert.equal(validate(sent), true, JSON.stringify(validate.errors));
  assert.deepEqual(normalizeExtractBatchInput(sent), input);
});

test("single-page GET and explicitly requested one-item batch are constructible", async () => {
  const target = assertPublicHttpsUrl("https://example.com/");
  const endpoint = new URL("https://agents.samedaydesk.com/extract");
  endpoint.searchParams.set("url", target);
  const get = new Request(endpoint);
  assert.equal(get.method, "GET");
  assert.equal(get.body, null);
  assert.deepEqual([...get.headers], []);
  assert.equal(new URL(get.url).searchParams.get("url"), target);
  const body = canonicalExtractBatchBody(normalizeExtractBatchInput({ urls: [target], fields: ["title"] }));
  assert.deepEqual(body, { urls: [target], fields: ["title"] });
});

test("merchant input validation rejects six URLs without constructing split requests", () => {
  assert.throws(() => normalizeExtractBatchInput({
    urls: Array.from({ length: 6 }, (_, n) => `https://example.com/${n}`), fields: ["title"],
  }), /1 to 5/);
});

test("mechanical single and batch requests reuse public HTTPS validation", () => {
  for (const url of ["http://example.com/", "https://localhost/", "https://127.0.0.1/",
    "https://192.168.1.1/", "https://[::1]/", "https://user:pass@example.com/", "not a url"]) {
    assert.throws(() => assertPublicHttpsUrl(url), url);
    assert.throws(() => normalizeExtractBatchInput({ urls: [url], fields: ["title"] }), url);
  }
  for (const fields of [[], ["unknown"], ["title", "title"]]) {
    assert.throws(() => normalizeExtractBatchInput({ urls: ["https://example.com/"], fields }));
  }
});

test("packaged Claude batch example passes the real merchant input validator", () => {
  const skill = readUtf8(join(REPO_ROOT, "plugins/samedaydesk-extract/skills/web-extract/SKILL.md"));
  const block = skill.match(/\x60\x60\x60http\n([\s\S]*?)\n\x60\x60\x60/)[1];
  const [headers, body] = block.split("\n\n");
  assert.equal(headers, "POST https://agents.samedaydesk.com/extract/batch\nContent-Type: application/json");
  const parsed = JSON.parse(body);
  assert.deepEqual(canonicalExtractBatchBody(normalizeExtractBatchInput(parsed)), parsed);
});
