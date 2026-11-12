import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  compareSourceDrift,
  loadSourceDriftFixture,
  observedFactsFromFixture,
  recordedFactsAt,
  describeCapabilities,
  PIN,
} from "../src/index.mjs";
import { assertPreviewEnvelope } from "../src/validate-preview-schema.mjs";
import { startLoopbackPageChange } from "../../samedaydesk-capability-compat-consumer/test-only/start-loopback-page-change.mjs";

const fixture = loadSourceDriftFixture();
const pinFacts = observedFactsFromFixture(fixture);
const FIXED_NOW = new Date("2026-11-12T11:00:00.000Z");

let profile;

before(async () => {
  profile = await startLoopbackPageChange();
});

after(async () => {
  await profile.close();
});

test("positive: recorded pin facts have no source drift", async () => {
  const expected = {
    repo: fixture.repo,
    sha: pinFacts.sha,
    sdkVersion: pinFacts.sdkVersion,
    serviceVersion: pinFacts.serviceVersion,
  };
  const drift = compareSourceDrift({ expectedSource: expected, observed: pinFacts, fixture });
  assert.equal(drift.ok, true);
  assert.equal(drift.classification, "none");
  assert.equal(drift.sdk, "none");
  assert.equal(drift.service, "none");
  assert.equal(drift.shaChanged, false);
  assert.deepEqual(drift.changes, []);

  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    expectedSource: expected,
    sourceFacts: pinFacts,
    now: () => FIXED_NOW,
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.source.changed, false);
  assert.equal(envelope.changes.some((change) => change.kind === "source_version_changed" || change.kind === "client_sdk_changed"), false);
  assert.equal(envelope.preview.verdict, "changed");
  assert.equal(envelope.paymentSignature, null);
  assertPreviewEnvelope(envelope);
});

test("changed-source: sdk 1.30.0 to 1.32.2 is detected and accepted with recovery", async () => {
  const before = recordedFactsAt(fixture.sdkDrift.before.commit, fixture);
  assert.equal(before.sdkVersion, "1.30.0");
  assert.equal(before.serviceVersion, "1.23.55");
  assert.equal(fixture.sdkDrift.before.packageLock.gitBlobSha, "d9965d0f25c9fa099bf2680bed6c1163b5423af8");
  assert.equal(fixture.sdkDrift.before.packageLock.sdk.version, "1.30.0");
  assert.equal(fixture.observedAtInstalledPin.packageLock.gitBlobSha, "c568833fa05e7d83c7d863f28e1435e43d21df74");
  assert.equal(fixture.observedAtInstalledPin.packageLock.sdk.version, "1.32.2");
  assert.equal(fixture.sdkDrift.introducedAt.commit, "498e4fb515570cd0883605ad4450449cadb272a1");

  const drift = compareSourceDrift({ expectedSource: before, observed: pinFacts, fixture });
  assert.equal(drift.ok, true);
  assert.equal(drift.classification, "compatible-minor");
  assert.equal(drift.sdk, "compatible-minor");
  assert.equal(drift.service, "none");
  const sdkChange = drift.changes.find((change) => change.kind === "client_sdk_changed");
  assert.ok(sdkChange);
  assert.equal(sdkChange.detected, true);
  assert.equal(sdkChange.recovered, true);
  assert.equal(sdkChange.evidence.expected, "1.30.0");
  assert.equal(sdkChange.evidence.observed, "1.32.2");
  assert.equal(sdkChange.recovery.action, "reconnect");
  assert.equal(sdkChange.recovery.protocol, "2025-11-25");
  assert.equal(sdkChange.evidence.keepContract, "synchronous-free-page-change");

  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    expectedSource: before,
    sourceFacts: pinFacts,
    now: () => FIXED_NOW,
  });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.source.changed, true);
  const envelopeSdk = envelope.changes.find((change) => change.kind === "client_sdk_changed" && change.evidence?.role === "merchant-lock");
  assert.ok(envelopeSdk);
  assert.equal(envelopeSdk.recovered, true);
  assert.equal(envelopeSdk.recovery.protocol, "2025-11-25");
  const pinChange = envelope.changes.find((change) => change.kind === "source_version_changed");
  assert.ok(pinChange);
  assert.equal(pinChange.recovered, false);
  assert.equal(pinChange.recovery.action, "re_pin");
  assert.equal(envelope.preview.verdict, "changed");
  assert.equal(envelope.paymentSignature, null);
  assertPreviewEnvelope(envelope);
});

test("service-version bump 1.23.54 to 1.23.55 is detected from recorded commits", async () => {
  const before = recordedFactsAt(fixture.serviceVersionDrift.before.commit, fixture);
  const after = recordedFactsAt(fixture.serviceVersionDrift.introducedAt.commit, fixture);
  assert.equal(before.serviceVersion, "1.23.54");
  assert.equal(before.sdkVersion, "1.30.0");
  assert.equal(after.serviceVersion, "1.23.55");
  assert.equal(after.sdkVersion, "1.30.0");
  assert.equal(fixture.serviceVersionDrift.introducedAt.commit, "cd0609e5ad68e0b5a9e0fa90e17d26a8998235e7");
  assert.equal(fixture.serviceVersionDrift.before.commit, "b309c6e2a1e1794a324c1c422c1c841a76038686");
  assert.equal(fixture.serviceVersionDrift.versionSource.commit, "ef846285b02d76cb09bfa92925f6a330e3037b07");
  assert.equal(fixture.serviceVersionDrift.versionSource.serviceVersionThen, "1.11.50");

  const drift = compareSourceDrift({ expectedSource: before, observed: after, fixture });
  assert.equal(drift.ok, true);
  assert.equal(drift.classification, "compatible-minor");
  assert.equal(drift.service, "compatible-minor");
  assert.equal(drift.sdk, "none");
  const changed = drift.changes.find((change) => change.kind === "source_version_changed");
  assert.ok(changed);
  assert.equal(changed.detected, true);
  assert.equal(changed.recovered, false);
  assert.equal(changed.recovery.action, "re_pin");
  assert.equal(changed.evidence.expectedServiceVersion, "1.23.54");
  assert.equal(changed.evidence.observedServiceVersion, "1.23.55");

  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    expectedSource: before,
    sourceFacts: after,
    now: () => FIXED_NOW,
  });
  assert.equal(envelope.ok, true);
  const envelopeChange = envelope.changes.find((change) => change.kind === "source_version_changed");
  assert.ok(envelopeChange);
  assert.equal(envelopeChange.evidence.expectedServiceVersion, "1.23.54");
  assert.equal(envelopeChange.evidence.observedServiceVersion, "1.23.55");
  assert.equal(envelope.preview.verdict, "changed");
  assert.equal(envelope.paymentSignature, null);
  assertPreviewEnvelope(envelope);
});

test("failure: unknown unmapped drift refuses clearly and does not throw", async () => {
  const expected = {
    repo: fixture.repo,
    sha: pinFacts.sha,
    sdkVersion: "9.9.9",
    serviceVersion: pinFacts.serviceVersion,
  };
  const drift = compareSourceDrift({ expectedSource: expected, observed: pinFacts, fixture });
  assert.equal(drift.ok, false);
  assert.equal(drift.classification, "unmapped");
  assert.equal(drift.protocolAffecting, true);
  assert.equal(drift.error.code, "protocol_unrecoverable");
  assert.match(drift.error.recovery.instruction, /Unmapped source drift/);
  assert.equal(drift.error.recovery.action, "re_pin");

  const envelope = await describeCapabilities({
    endpoint: profile.endpoint,
    expectedSource: expected,
    sourceFacts: pinFacts,
    now: () => FIXED_NOW,
  });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "protocol_unrecoverable");
  assert.match(envelope.error.recovery.instruction, /Unmapped source drift/);
  assert.equal(envelope.paymentSignature, null);
  assert.equal(envelope.observedAt, "2026-11-12T11:00:00.000Z");
  assertPreviewEnvelope(envelope);
});
