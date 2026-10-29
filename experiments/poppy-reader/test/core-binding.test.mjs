import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assessCheckout, fetchH64220Head, finishAssessment, H64220, remoteHead } from "../src/core-binding.mjs";
import { interoperabilityDecision } from "../src/decision.mjs";

const MANIFEST = {
  schema: H64220.schema,
  module: "./mod.mjs",
  export: "verifyPoppySession",
};

async function writeCore(root, { moduleName = "mod.mjs", source, manifest = MANIFEST } = {}) {
  const scope = path.join(root, H64220.scope);
  await mkdir(scope, { recursive: true });
  if (source !== undefined) await writeFile(path.join(scope, moduleName), source);
  await writeFile(path.join(scope, "EXPORT.json"), JSON.stringify(manifest));
  return scope;
}

test("a labelled local manifest can load without becoming H64220 integration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "h64221-local-core-"));
  await writeCore(root, {
    source: "export function verifyPoppySession() { return { ok: false, error: 'invalid_session', evidence: 'local-manifest-fixture' }; }\n",
  });
  const assessed = await assessCheckout(root, "local-fixture");
  assert.equal(assessed.evidence, "checkout");
  assert.equal(assessed.reason, "loaded-function");
  assert.equal(typeof assessed.verify, "function");
  const invoked = await assessed.verify({ header: "local" });
  assert.equal(invoked.evidence, "local-manifest-fixture");
  const finished = finishAssessment(assessed, { invoked: true });
  assert.equal(finished.integrated, true);
  assert.equal(finished.evidence, "checkout");
  const decision = interoperabilityDecision(finished);
  assert.equal(decision.integratedWithH64220, false);
  assert.equal(decision.boundaryFixtureIsIntegration, false);
  assert.equal(decision.publicPoppySupportClaim, false);

  const outside = path.join(root, "outside.mjs");
  await writeFile(outside, "export function verifyPoppySession() { return { ok: true }; }\n");
  const scope = path.join(root, H64220.scope);
  await symlink(outside, path.join(scope, "link.mjs"));
  await writeFile(path.join(scope, "EXPORT.json"), JSON.stringify({ ...MANIFEST, module: "./link.mjs" }));
  const escaped = await assessCheckout(root, "local-fixture");
  assert.equal(escaped.reason, "module-escapes-scope");
  assert.equal(escaped.verify, null);

  await writeFile(path.join(scope, "EXPORT.json"), JSON.stringify({ ...MANIFEST, schema: "other" }));
  const rejected = await assessCheckout(root, "local-fixture");
  assert.equal(rejected.reason, "manifest-rejected");
});

test("fetched H64220 head is executed only through its declared export", { timeout: 120000 }, async () => {
  const remote = remoteHead();
  const dest = path.join(tmpdir(), "h64221-h64220-head");
  const fetched = await fetchH64220Head(dest);
  assert.equal(fetched.head, remote);
  assert.equal(fetched.evidence, "fetched-source");
  assert.equal(fetched.repository, H64220.repository);
  assert.equal(fetched.branch, H64220.branch);
  let invoked = false;
  let invokeError = null;
  if (typeof fetched.verify === "function") {
    try {
      const result = await Promise.race([
        fetched.verify({
          header: "not-a-session",
          method: "POST",
          url: "https://reader.lab.example/poppy/v0/trial-read",
          issuer: "https://issuer.lab.example",
          now: Date.parse("2026-10-29T18:00:00Z"),
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
      assert.equal(typeof result, "object");
      invoked = true;
    } catch (error) {
      invokeError = error.message;
    }
  }
  const finished = finishAssessment(fetched, { invoked, invokeError });
  if (!fetched.manifestPresent) {
    assert.equal(fetched.reason, "manifest-absent");
    assert.equal(finished.integrated, false);
    assert.equal(finished.invoked, false);
  }
  const decision = interoperabilityDecision(finished);
  assert.equal(decision.boundaryFixtureIsIntegration, false);
  assert.equal(decision.publicPoppySupportClaim, false);
  assert.equal(decision.directRoutesRemainSupported, true);
  if (!finished.integrated) {
    assert.match(decision.action, /Do not advertise Poppy support/);
  }
  console.log(`H64220_ASSESSMENT ${JSON.stringify(finished)}`);
  console.log(`H64221_DECISION ${JSON.stringify(decision)}`);
});
