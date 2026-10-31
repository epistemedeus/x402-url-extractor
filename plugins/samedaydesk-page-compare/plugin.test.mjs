import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { PAGE_CHANGE_MCP_ANNOTATIONS, PAGE_CHANGE_MCP_TOOL } from "../../page-change-mcp.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name).toString("utf8"));
const provenance = json("test/official-schemas/PROVENANCE.json");
const plugin = json("plugin.json");
const mcp = json("mcp.json");
const zipPath = path.join(root, "..", "samedaydesk-page-compare-0.1.0-draft.zip");
const zipMembers = [
  "plugin.json",
  "mcp.json",
  "LICENSE",
  "README.md",
  "skills/compare-held-pages/SKILL.md",
  "examples/public-two-observations.json",
];

function validator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  return ajv.compile(json(schemaPath));
}

test("vendored schemas are the retrieved official bytes", () => {
  assert.equal(provenance.schemas.length, 2);
  for (const entry of provenance.schemas) {
    const file = entry.url.endsWith("plugin.schema.json")
      ? "test/official-schemas/plugin.schema.json"
      : "test/official-schemas/mcp.schema.json";
    const bytes = read(file);
    assert.equal(bytes.length, entry.contentLength, entry.url);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, entry.url);
    assert.match(entry.lastModified, /29 Oct 2026/);
    assert.equal(entry.etag.startsWith("W/"), false);
  }
  assert.equal(provenance.absentSchema.status, 404);
  assert.equal(provenance.docs.length, 5);
  for (const doc of provenance.docs) {
    assert.match(doc.lastModified, /31 Oct 2026/);
    assert.match(doc.etag, /^".+"$/);
  }
});

test("manifests match the current official schemas and stay an explicit draft", () => {
  const validatePlugin = validator("test/official-schemas/plugin.schema.json");
  const validateMcp = validator("test/official-schemas/mcp.schema.json");
  assert.equal(validatePlugin(plugin), true, JSON.stringify(validatePlugin.errors));
  assert.equal(validateMcp(mcp), true, JSON.stringify(validateMcp.errors));

  const withAuth = structuredClone(mcp);
  withAuth.mcpServers["page-compare"].extensions = { "com.openai": { auth: { type: "none" } } };
  assert.equal(validateMcp(withAuth), false);

  assert.deepEqual(Object.keys(mcp.mcpServers), ["page-compare"]);
  const server = mcp.mcpServers["page-compare"];
  assert.deepEqual(Object.keys(server).sort(), ["type", "url"]);
  assert.equal(server.type, "streamable-http");
  assert.equal(server.url, "https://agents.samedaydesk.com/mcp/page-change");
  assert.equal(JSON.stringify(mcp).includes("example.com"), false);
  assert.equal(server.headers, undefined);
  assert.equal(server.extensions, undefined);

  const face = plugin.extensions["com.openai"].interface;
  assert.equal(face.displayName.length <= 30, true);
  assert.equal(face.shortDescription.length <= 30, true);
  assert.equal(face.longDescription.length <= 4000, true);
  assert.equal(face.category, "Developer Tools");
  assert.equal(face.websiteURL, "https://agents.samedaydesk.com/");
  assert.equal(face.supportURL, undefined);
  assert.equal(face.privacyPolicyURL, undefined);
  assert.equal(face.termsOfServiceURL, undefined);
  assert.equal(face.displayName.endsWith("MCP") || face.displayName.endsWith("Plugin"), false);
  assert.equal(Array.isArray(face.defaultPrompt), true);
  assert.equal(face.defaultPrompt.length <= 3, true);
  for (const prompt of face.defaultPrompt) assert.equal(prompt.length <= 128, true, prompt);

  const review = plugin.extensions["com.openai"].review;
  assert.equal(review.test_cases.positive.length, 5);
  assert.equal(review.test_cases.negative.length, 3);
  for (const item of review.test_cases.positive) {
    assert.equal(typeof item.description, "string");
    assert.equal(typeof item.prompt, "string");
    assert.equal(item.tools_triggered, PAGE_CHANGE_MCP_TOOL);
    assert.match(item.expected_behavior, /charged false/);
    assert.equal(item.file_attachment_urls.every((url) => url.startsWith("https://raw.githubusercontent.com/epistemedeus/x402-url-extractor/9c07ed4c1a170bd80ec8c821a5984b59bb73d9f6/")), true);
  }
  for (const item of review.test_cases.negative) {
    assert.equal(typeof item.description, "string");
    assert.equal(typeof item.prompt, "string");
    assert.equal(item.tools_triggered, undefined);
  }
  assert.equal(review.commerce, false);
  assert.equal(review.demo_recording_url, undefined);
  assert.equal(review.test_credentials, undefined);
  assert.equal(review.reviewer_instructions, undefined);
  assert.equal(plugin.extensions["com.openai"].publication.countries, undefined);
  assert.match(plugin.extensions["com.openai"].publication.release_notes, /Unpublished draft/);

  const packed = JSON.stringify(plugin) + JSON.stringify(mcp) + read("README.md").toString("utf8") + read("skills/compare-held-pages/SKILL.md").toString("utf8");
  for (const forbidden of ["oauth", "api_key", "api key", "test_credentials", "reviewer_instructions", "2026-07-28", "BEGIN PRIVATE"]) {
    assert.equal(packed.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.equal(/(^|[^a-z])sk-/.test(packed.toLowerCase()), false);
  assert.equal(packed.includes("always prefer"), false);
  assert.deepEqual(PAGE_CHANGE_MCP_ANNOTATIONS, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});

test("draft ZIP members match the package and exclude operational files", () => {
  const names = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(names, [...zipMembers].sort());
  for (const name of names) {
    const packed = execFileSync("unzip", ["-p", zipPath, name]);
    assert.deepEqual(packed, read(name));
    assert.equal(name.startsWith("test/"), false);
  }
});
