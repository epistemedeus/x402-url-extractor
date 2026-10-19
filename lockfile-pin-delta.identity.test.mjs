import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import { LOCKFILE_PIN_DELTA_ENGINE_SHA } from "./lockfile-pin-delta-config.mjs";
import {
  executeLockfilePinDelta,
  lockfilePinDeltaMcpOutputSchema,
  lockfilePinDeltaOutputSchema,
  ownedLockfileWorkerCount,
  serveLockfilePinDelta,
} from "./lockfile-pin-delta.mjs";
import { compareLockfileTexts } from "./vendor/lockfile-pin-delta/lib/compare.mjs";

// Consumer receiving for the original issue 125 and 126 lockfile objects.
// Those bodies stay qualification inputs. This file checks the configured
// direct adapter, worker, and the HTTP/MCP result formatter. It does not
// settle a payment or call a live facilitator.

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, "fixtures/lockfile-pin-delta", name), "utf8"));
const issue125 = { before: read("identity/issue-125-before.json"), after: read("identity/issue-125-after.json") };
const issue126 = { before: read("identity/issue-126-before.json"), after: read("identity/issue-126-after.json") };
const validateHttp = new Ajv2020({ strict: false, allErrors: true }).compile(lockfilePinDeltaOutputSchema());

function sha256Json(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

function assertFormatted(result, label) {
  assert.equal(validateHttp(result), true, `${label} ${JSON.stringify(validateHttp.errors)}`);
  lockfilePinDeltaMcpOutputSchema.parse(result);
  if (result.engine) assert.equal(result.digest, sha256Json(result.engine), label);
  assert.equal(result.engineProvenance.sha, LOCKFILE_PIN_DELTA_ENGINE_SHA, label);
  assert.equal(result.boundary.purchaseAuthority, false, label);
  assert.equal(result.boundary.soldFlag, false, label);
  assert.equal(result.boundary.npmInstall, false, label);
  assert.equal(result.engine?.purchaseAuthority, false, label);
}

async function bothPaths(input) {
  const direct = await executeLockfilePinDelta({ input, inProcess: true });
  const worker = await executeLockfilePinDelta({ input });
  assert.equal(ownedLockfileWorkerCount(), 0);
  return { direct, worker };
}

function mockRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("direct and worker project issue 125 and 126 into HTTP and MCP results", async () => {
  const scoped = await bothPaths(issue125);
  for (const [label, result] of [["direct", scoped.direct], ["worker", scoped.worker]]) {
    assertFormatted(result, `125 ${label}`);
    assert.equal(result.ok, true);
    assert.equal(result.analysis, "actionable");
    assert.equal(result.transport, "ok");
    assert.equal(result.charged, true);
    assert.equal(result.engine.counts.changed, 1);
    assert.equal(result.engine.counts.unchanged, 0);
    assert.equal(result.engine.counts.missingIntegrity, 0);
    assert.equal(result.engine.changed[0].id, "node_modules/@team-node_modules/widget");
    assert.equal(result.engine.changed[0].name, "@team-node_modules/widget");
    assert.equal(result.engine.changed[0].before.name, "@team-node_modules/widget");
    assert.equal(result.engine.changed[0].after.name, "@team-node_modules/widget");
    assert.deepEqual(result.engine.changed[0].changeKinds, ["version", "integrity", "resolved"]);
    assert.match(result.markdown, /@team-node_modules\/widget/);
    assert.equal(result.markdown.includes("`widget`"), false);
  }
  assert.equal(scoped.direct.digest, scoped.worker.digest);
  assert.equal(scoped.direct.markdown, scoped.worker.markdown);

  const alias = await bothPaths(issue126);
  for (const [label, result] of [["direct", alias.direct], ["worker", alias.worker]]) {
    assertFormatted(result, `126 ${label}`);
    assert.equal(result.ok, true);
    assert.equal(result.analysis, "informational");
    assert.equal(result.transport, "ok");
    assert.equal(result.engine.counts.changed, 0);
    assert.equal(result.engine.counts.unchanged, 1);
    assert.equal(result.engine.counts.added, 0);
    assert.equal(result.engine.counts.removed, 0);
    assert.match(result.markdown, /changed 0/);
    assert.equal(result.markdown.includes("npm:is-number@7.0.0"), false);
    assert.equal(result.markdown.includes("## Changed"), false);
  }
  assert.equal(alias.direct.digest, alias.worker.digest);
  assert.equal(ownedLockfileWorkerCount(), 0);
});

test("HTTP handler returns the same issue 125 body and recovers after refusal", async () => {
  const refused = mockRes();
  await serveLockfilePinDelta({
    body: { before: "<!DOCTYPE html><html></html>", after: issue125.after },
    rawBody: Buffer.from("{}"),
  }, refused);
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.body.code, "html-input");
  assert.equal(refused.body.charged, false);
  assert.equal(refused.body.analysis, "not-run");
  assert.equal(refused.body.transport, "rejected");
  assert.equal(validateHttp(refused.body), false);

  const unsupported = mockRes();
  await serveLockfilePinDelta({
    body: { before: read("unsupported-version.json"), after: issue126.after },
    rawBody: Buffer.from("{}"),
  }, unsupported);
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupported.body.charged, false);
  assert.equal(unsupported.body.analysis, "not-run");

  const recovered = mockRes();
  await serveLockfilePinDelta({
    body: issue125,
    rawBody: Buffer.from(JSON.stringify(issue125)),
  }, recovered);
  assert.equal(recovered.statusCode, 200);
  assertFormatted(recovered.body, "http 125");
  assert.equal(recovered.body.analysis, "actionable");
  assert.equal(recovered.body.engine.changed[0].name, "@team-node_modules/widget");
  assert.deepEqual(recovered.body.engine.changed[0].changeKinds, ["version", "integrity", "resolved"]);
  assert.equal(ownedLockfileWorkerCount(), 0);

  const alias = mockRes();
  await serveLockfilePinDelta({
    body: issue126,
    rawBody: Buffer.from(JSON.stringify(issue126)),
  }, alias);
  assert.equal(alias.statusCode, 200);
  assert.equal(alias.body.analysis, "informational");
  assert.equal(alias.body.engine.counts.unchanged, 1);
  assert.equal(ownedLockfileWorkerCount(), 0);
});

test("worker crash stays fail-closed, then the real worker recovers", async () => {
  const crashed = await executeLockfilePinDelta({
    input: issue126,
    env: {
      ...process.env,
      LOCKFILE_PIN_DELTA_WORKER_PATH: join(here, "fixtures/lockfile-pin-delta/workers/nonzero-exit.mjs"),
    },
  });
  assert.equal(crashed.ok, false);
  assert.equal(crashed.charged, false);
  assert.equal(crashed.analysis, "not-run");
  assert.equal(crashed.transport, "engine-crash");
  assert.equal(crashed.engine, null);
  assert.equal(crashed.digest, null);
  assert.equal(ownedLockfileWorkerCount(), 0);
  const recovered = await executeLockfilePinDelta({ input: issue126 });
  assert.equal(recovered.analysis, "informational");
  assert.equal(recovered.transport, "ok");
  assert.equal(recovered.engine.counts.unchanged, 1);
  assert.equal(ownedLockfileWorkerCount(), 0);
});

test("projected engine keeps missing-integrity, real deltas, and hasher controls", () => {
  const missing = compareLockfileTexts(
    JSON.stringify(read("identity/issue-126-before.json")),
    JSON.stringify({
      name: "partial-alias",
      version: "1.0.0",
      lockfileVersion: 2,
      dependencies: { renamed: { version: "npm:is-number@7.0.0" } },
    }),
  );
  assert.equal(missing.status, "partial");
  assert.equal(missing.counts.missingIntegrity > 0, true);
  const git = compareLockfileTexts(
    JSON.stringify(read("git-resolved-before.json")),
    JSON.stringify(read("git-resolved-after.json")),
  );
  assert.equal(git.status, "actionable");
  assert.ok(git.changed.some((item) => item.changeKinds.includes("resolved")));
  const before = readFileSync(join(here, "vendor/lockfile-pin-delta/fixtures/integrity-only/before.json"), "utf8");
  const after = readFileSync(join(here, "vendor/lockfile-pin-delta/fixtures/integrity-only/after.json"), "utf8");
  const constant = compareLockfileTexts(before, after, { hashPinTerms: () => "constant" });
  assert.equal(constant.counts.changed, 1);
  assert.deepEqual(constant.changed[0].changeKinds, ["integrity"]);
  let n = 0;
  const unstable = compareLockfileTexts(before, before, { hashPinTerms: () => String(++n) });
  assert.equal(unstable.counts.changed, 0);
  assert.ok(unstable.counts.unchanged >= 1);
});
