import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assertExtractDiscoveryInventory,
  constructExtractBatchBody,
  selectExtractRoute,
} from "./extract-discovery-inventory.mjs";

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

function sampleBatchTool(overrides = {}) {
  return {
    name: "extract_batch",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["urls"],
      properties: {
        urls: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
        fields: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "title", "description", "canonical", "lang", "openGraph", "twitter",
              "jsonLd", "headings", "links", "text", "aiReadiness",
            ],
          },
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["ok", "product", "partial", "sources", "charged", "boundary"],
      properties: {},
    },
    ...overrides,
  };
}

function sampleExtractTool() {
  return {
    name: "extract",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string" } },
    },
  };
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

test("recipe pins extract and extract_batch discovery without a wrapper paywall", () => {
  const recipe = readUtf8(join(GOOSE_ROOT, "extract.recipe.yaml"));
  assert.match(recipe, /available_tools:\n      - extract\n      - extract_batch/);
  assert.match(recipe, /not authorization/);
  assert.match(recipe, /uri: "https:\/\/agents\.samedaydesk\.com\/mcp"/);
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

test("fixture tools/list accepts an unrelated extra tool when extract schemas are valid", () => {
  const tools = [
    sampleExtractTool(),
    sampleBatchTool(),
    { name: "unrelated_probe", inputSchema: { type: "object", properties: {} } },
  ];
  const found = assertExtractDiscoveryInventory(tools);
  assert.equal(found.names.includes("unrelated_probe"), true);
  assert.equal(found.names.includes("extract_batch"), true);
});

test("fixture tools/list rejects missing or invalid extract_batch", () => {
  assert.throws(
    () => assertExtractDiscoveryInventory([sampleExtractTool()]),
    /missing extract_batch/,
  );
  assert.throws(
    () => assertExtractDiscoveryInventory([
      sampleExtractTool(),
      sampleBatchTool({
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["urls"],
          properties: {
            urls: { type: "array", minItems: 1, maxItems: 99, items: { type: "string" } },
            fields: sampleBatchTool().inputSchema.properties.fields,
          },
        },
      }),
    ]),
    /urls\.maxItems must be 5/,
  );
  assert.throws(
    () => assertExtractDiscoveryInventory([
      sampleExtractTool(),
      sampleBatchTool({
        outputSchema: { type: "object", required: ["ok"], properties: {} },
      }),
    ]),
    /outputSchema missing required (product|partial|sources|charged|boundary)/,
  );
});

test("mechanical batch body construction matches canonical unpaid POST JSON", () => {
  const urls = [
    "https://example.com/",
    "https://example.org/",
    "https://www.rfc-editor.org/rfc/rfc3986",
  ];
  const fields = ["title", "description", "headings"];
  const body = constructExtractBatchBody({ urls, fields });
  assert.deepEqual(body, { urls, fields });
  assert.equal(JSON.stringify(body).includes("PAYMENT"), false);
  assert.equal(JSON.stringify(body).includes("private"), false);

  const three = selectExtractRoute({ urls, fields, batchSupported: true });
  assert.equal(three.reject, false);
  assert.equal(three.method, "POST");
  assert.equal(three.url, "https://agents.samedaydesk.com/extract/batch");
  assert.deepEqual(three.body, body);

  const one = selectExtractRoute({ urls: ["https://example.com/"], fields: [], batchSupported: true });
  assert.equal(one.reject, false);
  assert.equal(one.method, "GET");
  assert.match(one.url, /^https:\/\/agents\.samedaydesk\.com\/extract\?url=/);

  const six = selectExtractRoute({
    urls: [
      "https://example.com/1",
      "https://example.com/2",
      "https://example.com/3",
      "https://example.com/4",
      "https://example.com/5",
      "https://example.com/6",
    ],
    fields,
    batchSupported: true,
  });
  assert.equal(six.reject, true);
  assert.equal(six.reason, "too_many_urls_no_autosplit");
});
