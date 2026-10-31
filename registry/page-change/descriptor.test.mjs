import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DESCRIPTOR_DESCRIPTION,
  DESCRIPTOR_NAME,
  DESCRIPTOR_VERSION,
  PAID_NAME,
  PAID_REMOTE,
  REGISTRY_SCHEMA_SHA256,
  REGISTRY_SCHEMA_URL,
  assertFreeDescriptor,
  assertPaidIdentity,
  buildDescriptor,
  canonicalDescriptorText,
  checkAll,
  profileContract,
  refuseEquivalentRemotes,
  schemaDocument,
} from "./check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const serviceVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;

function rejected(mutate, code) {
  const descriptor = buildDescriptor();
  mutate(descriptor);
  assert.throws(() => assertFreeDescriptor(descriptor, { serviceVersion }), (error) => error.code === code);
}

test("recovers the committed free descriptor and leaves the paid listing unchanged", () => {
  const result = checkAll();
  const contract = profileContract();
  assert.equal(result.ok, true);
  assert.equal(result.name, DESCRIPTOR_NAME);
  assert.equal(result.descriptorVersion, "1.0.0");
  assert.equal(result.descriptorVersion, DESCRIPTOR_VERSION);
  assert.equal(result.runtimeVersion, serviceVersion);
  assert.equal(result.remote, "https://agents.samedaydesk.com/mcp/page-change");
  assert.equal(result.remote, contract.url);
  assert.equal(result.tool, "compare_page_observations");
  assert.equal(contract.serverName, "samedaydesk-page-compare");
  assert.equal(result.schema, REGISTRY_SCHEMA_URL);
  assert.equal(result.schemaSha256, REGISTRY_SCHEMA_SHA256);
  assert.equal(readFileSync(path.join(here, "server.json"), "utf8"), canonicalDescriptorText());
  assert.equal(buildDescriptor().description, DESCRIPTOR_DESCRIPTION);
  assert.ok(DESCRIPTOR_DESCRIPTION.length <= schemaDocument().definitions.ServerDetail.properties.description.maxLength);
  assert.equal(result.name.startsWith("io.github.epistemedeus/"), true);
  const paid = JSON.parse(readFileSync(path.join(repoRoot, "server.json"), "utf8"));
  assert.equal(paid.name, PAID_NAME);
  assert.equal(paid.version, serviceVersion);
  assert.deepEqual(paid.remotes, [{ type: "streamable-http", url: PAID_REMOTE }]);
  assert.notDeepEqual(paid, buildDescriptor());
});

test("checker command exits 0 without a registry or tool call", () => {
  const result = spawnSync(process.execPath, ["registry/page-change/check.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^ok name=io\.github\.epistemedeus\/page-change descriptor=1\.0\.0 runtime=\d+\.\d+\.\d+ remote=https:\/\/agents\.samedaydesk\.com\/mcp\/page-change tool=compare_page_observations\n$/);
});

test("schema allows multiple remotes, and this package refuses different tool sets", () => {
  const schema = schemaDocument();
  assert.equal(schema.definitions.ServerDetail.properties.remotes.maxItems, undefined);
  assert.equal(schema.definitions.ServerDetail.properties.remotes.items.$ref, "#/definitions/RemoteTransport");
  const combined = {
    name: PAID_NAME,
    remotes: [
      { type: "streamable-http", url: PAID_REMOTE },
      { type: "streamable-http", url: "https://agents.samedaydesk.com/mcp/page-change" },
    ],
  };
  assert.throws(() => refuseEquivalentRemotes(combined), (error) => error.code === "equivalent_remotes");
  assert.throws(() => refuseEquivalentRemotes({
    name: DESCRIPTOR_NAME,
    remotes: [{ type: "streamable-http", url: PAID_REMOTE }],
  }), (error) => error.code === "equivalent_remotes");
  assert.doesNotThrow(() => refuseEquivalentRemotes({
    name: PAID_NAME,
    remotes: [{ type: "streamable-http", url: PAID_REMOTE }],
  }));
  assert.doesNotThrow(() => refuseEquivalentRemotes(buildDescriptor()));
});

test("refuses namespace, transport, payment, and descriptor-version drift", () => {
  rejected((descriptor) => { descriptor.name = "io.github.other/page-change"; }, "namespace");
  rejected((descriptor) => { descriptor.name = "io.github.epistemedeus/x402-data-gateway"; }, "paid_identity");
  rejected((descriptor) => { descriptor.name = "io.github.epistemedeus/other"; }, "name");
  rejected((descriptor) => { descriptor.version = "^1.0.0"; }, "version_range");
  rejected((descriptor) => { descriptor.version = "1.0.1"; }, "descriptor_version");
  rejected((descriptor) => {
    descriptor.description = "Paid extract and trial_read through a wallet. Payment required.";
  }, "paid_claim");
  rejected((descriptor) => { descriptor.description = "A short note."; }, "free_scope");
  rejected((descriptor) => { descriptor.remotes.push({ type: "sse", url: "https://agents.samedaydesk.com/sse" }); }, "remotes");
  rejected((descriptor) => { descriptor.remotes[0].type = "sse"; }, "transport");
  rejected((descriptor) => { descriptor.remotes[0].url = "http://agents.samedaydesk.com/mcp/page-change"; }, "https");
  rejected((descriptor) => { descriptor.remotes[0].url = PAID_REMOTE; }, "paid_remote");
  rejected((descriptor) => { descriptor.remotes[0].url = "https://user:pass@agents.samedaydesk.com/mcp/page-change"; }, "url_parts");
  rejected((descriptor) => { descriptor.remotes[0].headers = [{ name: "Authorization", value: "secret" }]; }, "remote_auth");
  rejected((descriptor) => { descriptor.packages = []; }, "packages");
  rejected((descriptor) => { descriptor._meta = { published: true }; }, "extra");
});

test("semantic descriptor keys do not depend on JSON member order", () => {
  const descriptor = buildDescriptor();
  const reordered = Object.fromEntries(Object.entries(descriptor).reverse());
  reordered.repository = Object.fromEntries(Object.entries(descriptor.repository).reverse());
  reordered.remotes = descriptor.remotes.map(remote => Object.fromEntries(Object.entries(remote).reverse()));
  assert.doesNotThrow(() => assertFreeDescriptor(reordered, {serviceVersion}));
  assert.throws(() => assertFreeDescriptor({...reordered, unexpected: true}, {serviceVersion}), e => e.code === "descriptor_keys");
  assert.doesNotThrow(() => assertFreeDescriptor(buildDescriptor(), {serviceVersion: DESCRIPTOR_VERSION}));
});

test("paid metadata can evolve while its identity and current runtime stay bound", () => {
  const paid = JSON.parse(readFileSync(path.join(repoRoot, "server.json"), "utf8"));
  const next = {...paid, version: "2.0.0", description: "A future maintained merchant description."};
  const lock = {version: "2.0.0", packages: {"": {version: "2.0.0"}}};
  assert.doesNotThrow(() => assertPaidIdentity("2.0.0", {paid: next, lock}));
  assert.throws(() => assertPaidIdentity("2.0.0", {paid: {...next, name: DESCRIPTOR_NAME}, lock}), e => e.code === "paid_name");
  assert.throws(() => assertPaidIdentity("2.0.0", {paid: {...next, remotes: buildDescriptor().remotes}, lock}), e => e.code === "paid_remote");
  assert.throws(() => assertPaidIdentity("1.0.0", {paid: next, lock}), e => e.code === "paid_version");
  assert.throws(() => assertPaidIdentity("2.0.0", {paid: next, lock: {...lock, version: "1.0.0"}}), e => e.code === "lock_version");
  assert.doesNotThrow(() => assertPaidIdentity("2.0.0", {paid: next, lock}));
});
