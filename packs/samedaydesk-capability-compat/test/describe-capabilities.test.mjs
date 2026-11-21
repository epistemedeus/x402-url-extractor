import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeCapabilities,
  protocolFromEnv,
  ENV_PROTOCOL_KEY,
  PREVIEW_SCHEMA,
  PIN,
  FREE_PAGE_CHANGE,
  OFFICIAL_CLIENT_NEGOTIATION,
  UNKNOWN_TOOL_RECOVERY,
} from "../src/index.mjs";
import { assertPreviewEnvelope, validatePreviewEnvelope, PREVIEW_SCHEMA_PATH } from "../src/validate-preview-schema.mjs";
import { startLoopbackPageChange } from "../../samedaydesk-capability-compat-consumer/test-only/start-loopback-page-change.mjs";

const packRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(packRoot, "bin/capability-compat.mjs");
const merchantSha = PIN.sourcePins.merchant.sha;
const merchantRepo = PIN.sourcePins.merchant.repo;
const FIXED_NOW = new Date("2026-11-12T11:00:00.000Z");
const FIXED_OBSERVED_AT = "2026-11-12T11:00:00.000Z";

let profile;
const originalFetch = globalThis.fetch;
const envSnapshot = snapshotEnv();

function snapshotEnv() {
  const keys = Object.keys(process.env).sort();
  return {
    keys,
    values: Object.fromEntries(keys.map((key) => [key, process.env[key]])),
  };
}

function assertEnvUntouched() {
  const current = snapshotEnv();
  assert.deepEqual(current.keys, envSnapshot.keys);
  for (const key of envSnapshot.keys) {
    assert.equal(process.env[key], envSnapshot.values[key]);
  }
  assert.equal(globalThis.fetch, originalFetch);
}

function assertPreviewShape(envelope) {
  assert.equal(envelope.schema, PREVIEW_SCHEMA);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.observedAt, FIXED_OBSERVED_AT);
  assert.match(envelope.observedAt, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/);
  assert.deepEqual(envelope.provider, { package: PIN.package, version: PIN.version });
  assert.equal(envelope.source.repo, merchantRepo);
  assert.equal(envelope.source.sha, merchantSha);
  assert.equal(typeof envelope.source.changed, "boolean");
  assert.equal(envelope.endpoint.url, profile.endpoint);
  assert.equal(envelope.endpoint.kind, "loopback");
  assert.equal(envelope.endpoint.liveClaimed, false);
  assert.deepEqual(envelope.protocol.supported, [OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol]);
  assert.equal(envelope.capabilities.length, 1);
  assert.equal(envelope.capabilities[0].tool, FREE_PAGE_CHANGE.tool);
  assert.equal(envelope.capabilities[0].path, FREE_PAGE_CHANGE.path);
  assert.equal(envelope.capabilities[0].effect, "read");
  assert.equal(envelope.capabilities[0].charged, false);
  assert.equal(envelope.capabilities[0].auth, "none");
  const digest = envelope.capabilities[0].inputSchemaDigest;
  assert.ok(digest === null || /^sha256:[0-9a-f]{64}$/.test(digest));
  assert.equal(envelope.preview.tool, FREE_PAGE_CHANGE.tool);
  assert.equal(envelope.preview.charged, false);
  assert.equal(envelope.preview.usefulResult, "page-change-verdict");
  assert.ok(envelope.preview.verdict);
  assert.equal(envelope.paymentSignature, null);
  assert.equal(envelope.installedVsHosted.network, false);
  assert.equal(envelope.installedVsHosted.liveClaimed, false);
  assert.equal(envelope.installedVsHosted.hostedSha, PIN.sourcePins.neomorphic.sha);
  assert.equal(typeof envelope.installedVsHosted.installedBytes, "number");
  assert.equal(typeof envelope.installedVsHosted.hostedBytes, "number");
  const allowedKinds = new Set([
    "protocol_refused",
    "unknown_tool",
    "source_version_changed",
    "client_sdk_changed",
    "env_changed",
  ]);
  const allowedActions = new Set(["reconnect", "list_tools", "re_pin", "none"]);
  for (const change of envelope.changes) {
    assert.ok(allowedKinds.has(change.kind), change.kind);
    assert.equal(typeof change.detected, "boolean");
    assert.equal(typeof change.recovered, "boolean");
    assert.ok(allowedActions.has(change.recovery.action), change.recovery.action);
  }
  const keys = Object.keys(envelope);
  assert.deepEqual(keys, [
    "schema",
    "ok",
    "observedAt",
    "provider",
    "source",
    "endpoint",
    "protocol",
    "capabilities",
    "preview",
    "changes",
    "installedVsHosted",
    "paymentSignature",
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(envelope), "utf8") <= 64 * 1024);
  assertPreviewEnvelope(envelope);
}

function injectedNow() {
  return FIXED_NOW;
}

before(async () => {
  profile = await startLoopbackPageChange();
});

after(async () => {
  await profile.close();
  assertEnvUntouched();
});

test("positive: describeCapabilities envelope conforms to preview.v1", async () => {
  const nowCalls = [];
  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    now: () => {
      nowCalls.push(FIXED_NOW);
      return FIXED_NOW;
    },
  });
  assertPreviewShape(envelope);
  assert.equal(envelope.source.changed, false);
  assert.equal(envelope.preview.verdict, "changed");
  assert.equal(envelope.observedAt, FIXED_OBSERVED_AT);
  assert.equal(nowCalls.length, 1);
  assertEnvUntouched();
});

test("recovery: env change client 2.4.0 pin 2026-07-28 uses SAMEDAYDESK_MCP_PROTOCOL", async () => {
  assert.equal(ENV_PROTOCOL_KEY, "SAMEDAYDESK_MCP_PROTOCOL");
  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    clientSdk: "2.4.0",
    env: { SAMEDAYDESK_MCP_PROTOCOL: "2026-07-28" },
    now: injectedNow,
  });
  assertPreviewShape(envelope);
  assert.equal(envelope.protocol.requested, "2026-07-28");
  assert.equal(envelope.protocol.negotiated, OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol);
  const refused = envelope.changes.find((change) => change.kind === "protocol_refused");
  assert.ok(refused);
  assert.equal(refused.detected, true);
  assert.equal(refused.recovered, true);
  assert.equal(refused.evidence.sdkErrorCode, OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode);
  assert.equal(refused.evidence.httpStatus, OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus);
  assert.equal(refused.evidence.jsonRpcCode, OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode);
  assert.equal(refused.recovery.action, "reconnect");
  assert.equal(refused.recovery.protocol, "2025-11-25");
  const envChanged = envelope.changes.find((change) => change.kind === "env_changed");
  assert.ok(envChanged);
  assert.equal(envChanged.detected, true);
  assert.equal(envelope.preview.verdict, "changed");
  assertEnvUntouched();
});

test("aliases and value heuristics for the protocol env key are ignored", async () => {
  assert.equal(protocolFromEnv({ MCP_PROTOCOL_VERSION: "2026-07-28" }), null);
  assert.equal(protocolFromEnv({ MCP_PROTOCOL: "2026-07-28" }), null);
  assert.equal(protocolFromEnv({ CAPABILITY_COMPAT_PROTOCOL: "2026-07-28" }), null);
  assert.equal(protocolFromEnv({ "2026-07-28": "1" }), null);
  assert.equal(protocolFromEnv({ PROTOCOL_PIN: "2026-07-28" }), null);
  assert.equal(protocolFromEnv({ SAMEDAYDESK_MCP_PROTOCOL: "2026-07-28" }), "2026-07-28");
  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    clientSdk: "2.4.0",
    env: {
      MCP_PROTOCOL_VERSION: "2026-07-28",
      MCP_PROTOCOL: "2026-07-28",
      CAPABILITY_COMPAT_PROTOCOL: "2026-07-28",
      PROTOCOL_PIN: "2026-07-28",
    },
    now: injectedNow,
  });
  assertPreviewShape(envelope);
  assert.equal(envelope.changes.some((change) => change.kind === "env_changed"), false);
  assertEnvUntouched();
});

test("recovery: wrong tool resolves through tools/list", async () => {
  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    now: injectedNow,
  });
  const unknown = envelope.changes.find((change) => change.kind === "unknown_tool");
  assert.ok(unknown);
  assert.equal(unknown.detected, true);
  assert.equal(unknown.recovered, true);
  assert.equal(unknown.evidence.jsonRpcCode, UNKNOWN_TOOL_RECOVERY.jsonRpcCode);
  assert.equal(unknown.recovery.action, "list_tools");
  assert.equal(unknown.recovery.nextMethod, "tools/list");
  assert.equal(envelope.preview.verdict, "changed");
  assertPreviewEnvelope(envelope);
  assertEnvUntouched();
});

test("recovery: source sha change is not a rejection and asks for re_pin", async () => {
  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    expectedSource: { repo: merchantRepo, sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    now: injectedNow,
  });
  assertPreviewShape(envelope);
  assert.equal(envelope.source.changed, true);
  const changed = envelope.changes.find((change) => change.kind === "source_version_changed");
  assert.ok(changed);
  assert.equal(changed.detected, true);
  assert.equal(changed.recovered, false);
  assert.equal(changed.recovery.action, "re_pin");
  assert.equal(envelope.preview.verdict, "changed");
  assert.equal(envelope.ok, true);
  assertEnvUntouched();
});

test("programmer error rejects; expected refusals do not", async () => {
  await assert.rejects(() => describeCapabilities({}), /endpoint is required/);
  await assert.rejects(() => describeCapabilities({ endpoint: "not-a-url" }), /absolute http/);
  await assert.rejects(() => describeCapabilities({ endpoint: profile.endpoint, env: "PAGE=1" }), /env must be/);
  await assert.rejects(
    () => describeCapabilities({ endpoint: profile.endpoint, expectedSource: { repo: "x" } }),
    /expectedSource/,
  );
  await assert.rejects(() => describeCapabilities({ endpoint: profile.endpoint, fetch: "nope" }), /fetch must be/);
  await assert.rejects(() => describeCapabilities({ endpoint: profile.endpoint, now: "now" }), /now must be/);

  const unsupported = await describeCapabilities({
    endpoint: profile.endpoint,
    clientSdk: "9.9.9",
    now: injectedNow,
  });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.error.code, "unsupported_client_sdk");
  assert.equal(unsupported.paymentSignature, null);
  assert.equal(unsupported.observedAt, FIXED_OBSERVED_AT);
  assertPreviewEnvelope(unsupported);
  assertEnvUntouched();
});

test("process.env is untouched and injected fetch is used instead of patching globalThis.fetch", async () => {
  const marker = `CAPABILITY_COMPAT_TEST_${Date.now()}`;
  assert.equal(process.env[marker], undefined);
  let calls = 0;
  const injected = async (input, init) => {
    calls += 1;
    return originalFetch(input, init);
  };
  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    env: { SAMEDAYDESK_MCP_PROTOCOL: "2026-07-28" },
    fetch: injected,
    now: injectedNow,
  });
  assert.equal(envelope.ok, true);
  assert.ok(calls > 0);
  assert.equal(globalThis.fetch, originalFetch);
  assert.equal(process.env[marker], undefined);
  assert.equal(Object.hasOwn(process.env, marker), false);
  assertPreviewEnvelope(envelope);
  assertEnvUntouched();
});

test("describeCapabilities output validates against the shipped preview.v1 schema", async () => {
  assert.match(PREVIEW_SCHEMA_PATH, /capability-provider\.preview\.v1\.schema\.json$/);
  const useful = await describeCapabilities({
    endpoint: profile.endpoint,
    now: injectedNow,
  });
  assertPreviewEnvelope(useful);
  const refused = await describeCapabilities({
    endpoint: profile.endpoint,
    clientSdk: "9.9.9",
    now: injectedNow,
  });
  assertPreviewEnvelope(refused);
  const invalid = { ...useful };
  delete invalid.observedAt;
  const errors = validatePreviewEnvelope(invalid);
  assert.ok(errors.length > 0);
});

test("bin describe emits the versioned envelope on stdout and maps exits", async () => {
  const result = await runBin(["describe", "--endpoint", profile.endpoint]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const envelope = JSON.parse(result.stdout.trim());
  assert.equal(envelope.schema, PREVIEW_SCHEMA);
  assert.equal(envelope.ok, true);
  assert.match(envelope.observedAt, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/);
  assertPreviewEnvelope(envelope);
});

function runBin(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: packRoot,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
