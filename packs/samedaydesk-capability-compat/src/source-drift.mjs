import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapClientSdk, OFFICIAL_CLIENT_NEGOTIATION, PIN } from "./map.mjs";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/source-drift.json");

export function loadSourceDriftFixture() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

export function observedFactsFromPin() {
  const merchant = PIN.sourcePins.merchant;
  return {
    repo: merchant.repo,
    sha: merchant.sha,
    sdkVersion: PIN.lockedDependencies["@modelcontextprotocol/sdk"],
    serviceVersion: merchant.packageVersion,
    origin: "pin",
  };
}

export function observedFactsFromFixture(fixture = loadSourceDriftFixture()) {
  const observed = fixture.observedAtInstalledPin;
  return {
    repo: fixture.repo,
    sha: observed.commit,
    sdkVersion: observed.sdkVersion,
    serviceVersion: observed.serviceVersion,
    origin: "recorded-fixture",
  };
}

export function recordedFactsAt(commit, fixture = loadSourceDriftFixture()) {
  if (commit === fixture.observedAtInstalledPin.commit) {
    return {
      repo: fixture.repo,
      sha: fixture.observedAtInstalledPin.commit,
      sdkVersion: fixture.observedAtInstalledPin.sdkVersion,
      serviceVersion: fixture.observedAtInstalledPin.serviceVersion,
      origin: "recorded-fixture",
    };
  }
  if (commit === fixture.sdkDrift.before.commit) {
    return {
      repo: fixture.repo,
      sha: fixture.sdkDrift.before.commit,
      sdkVersion: fixture.sdkDrift.before.sdkVersion,
      serviceVersion: fixture.sdkDrift.before.serviceVersion,
      origin: "recorded-fixture",
    };
  }
  if (commit === fixture.serviceVersionDrift.before.commit
    || commit === fixture.serviceVersionDrift.before.alsoReleasedAt.commit) {
    const before = fixture.serviceVersionDrift.before;
    const released = before.alsoReleasedAt;
    const match = commit === released.commit ? released : before;
    return {
      repo: fixture.repo,
      sha: match.commit || before.commit,
      sdkVersion: match.sdkVersion || before.sdkVersion,
      serviceVersion: match.serviceVersion || before.serviceVersion,
      origin: "recorded-fixture",
    };
  }
  if (commit === fixture.serviceVersionDrift.introducedAt.commit) {
    const intro = fixture.serviceVersionDrift.introducedAt;
    return {
      repo: fixture.repo,
      sha: intro.commit,
      sdkVersion: intro.sdkVersion,
      serviceVersion: intro.serviceVersion,
      origin: "recorded-fixture",
    };
  }
  return null;
}

function sameString(left, right) {
  return typeof left === "string" && typeof right === "string" && left === right;
}

function classifySdk(expected, observed, fixture) {
  if (expected == null || observed == null) return "none";
  if (sameString(expected, observed)) return "none";
  const allowedFrom = fixture.sdkDrift.before.sdkVersion;
  const allowedTo = fixture.observedAtInstalledPin.sdkVersion;
  if (expected === allowedFrom && observed === allowedTo) {
    try {
      const expectedKind = mapClientSdk(expected).kind;
      const observedKind = mapClientSdk(observed).kind;
      if (expectedKind === observedKind && expectedKind === fixture.sdkDrift.mapKind) {
        return "compatible-minor";
      }
    } catch {
      return "unmapped";
    }
  }
  try {
    mapClientSdk(expected);
    mapClientSdk(observed);
  } catch {
    return "unmapped";
  }
  return "unmapped";
}

function classifyService(expected, observed, fixture) {
  if (expected == null || observed == null) return "none";
  if (sameString(expected, observed)) return "none";
  const allowedFrom = fixture.serviceVersionDrift.before.serviceVersion;
  const allowedTo = fixture.serviceVersionDrift.introducedAt.serviceVersion;
  if (expected === allowedFrom && observed === allowedTo) return "compatible-minor";
  return "unmapped";
}

function normalizeFacts(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    const error = new Error(`${label} must be an object`);
    error.code = "programmer_error";
    throw error;
  }
  return {
    repo: value.repo ?? null,
    sha: value.sha ?? null,
    sdkVersion: value.sdkVersion ?? null,
    serviceVersion: value.serviceVersion ?? null,
  };
}

/**
 * Compare an expectedSource snapshot to observed merchant facts from the
 * installed pin or a recorded fixture. Classification is only none,
 * compatible-minor, or unmapped (treated as protocol-affecting refusal).
 * Compatible pairs are those recorded in fixtures/source-drift.json.
 */
export function compareSourceDrift({ expectedSource, observed, fixture } = {}) {
  const recorded = fixture || loadSourceDriftFixture();
  const expected = normalizeFacts(expectedSource || {}, "expectedSource");
  const actual = normalizeFacts(observed || observedFactsFromFixture(recorded), "observed");
  const sdk = classifySdk(expected.sdkVersion, actual.sdkVersion, recorded);
  const service = classifyService(expected.serviceVersion, actual.serviceVersion, recorded);
  const shaChanged = Boolean(expected.sha && actual.sha && expected.sha !== actual.sha);
  const repoChanged = Boolean(expected.repo && actual.repo && expected.repo !== actual.repo);

  const parts = [sdk, service].filter((item) => item !== "none");
  let classification = "none";
  if (parts.includes("unmapped")) classification = "unmapped";
  else if (parts.includes("compatible-minor") || shaChanged || repoChanged) {
    classification = parts.includes("compatible-minor") ? "compatible-minor" : "none";
    if (!parts.length && (shaChanged || repoChanged)) classification = "compatible-minor";
  }

  const changes = [];
  const supportedProtocol = OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol;

  if (sdk === "compatible-minor") {
    changes.push({
      kind: "client_sdk_changed",
      detected: true,
      recovered: true,
      evidence: {
        role: "merchant-lock",
        expected: expected.sdkVersion,
        observed: actual.sdkVersion,
        classification: "compatible-minor",
        keepContract: recorded.sdkDrift.keepContract,
        fromCommit: recorded.sdkDrift.before.commit,
        toCommit: recorded.sdkDrift.introducedAt.commit,
        observedCommit: recorded.observedAtInstalledPin.commit,
      },
      recovery: { action: "reconnect", protocol: supportedProtocol },
    });
  }

  if (service === "compatible-minor" || shaChanged || repoChanged) {
    const evidence = {
      expectedSha: expected.sha,
      installedSha: actual.sha,
      repo: actual.repo || expected.repo,
    };
    if (service === "compatible-minor") {
      evidence.expectedServiceVersion = expected.serviceVersion;
      evidence.observedServiceVersion = actual.serviceVersion;
      evidence.classification = "compatible-minor";
      evidence.fromCommit = recorded.serviceVersionDrift.before.commit;
      evidence.toCommit = recorded.serviceVersionDrift.introducedAt.commit;
    }
    if (shaChanged || repoChanged || service === "compatible-minor") {
      changes.push({
        kind: "source_version_changed",
        detected: true,
        recovered: false,
        evidence,
        recovery: { action: "re_pin" },
      });
    }
  }

  if (classification === "unmapped") {
    const detail = [
      expected.sdkVersion && sdk === "unmapped" ? `sdk ${expected.sdkVersion} -> ${actual.sdkVersion}` : null,
      expected.serviceVersion && service === "unmapped" ? `serviceVersion ${expected.serviceVersion} -> ${actual.serviceVersion}` : null,
    ].filter(Boolean).join("; ") || "source facts are not in the recorded compatible set";
    return {
      ok: false,
      classification: "unmapped",
      protocolAffecting: true,
      sdk,
      service,
      shaChanged,
      changes: [],
      error: {
        code: "protocol_unrecoverable",
        retryable: false,
        recovery: {
          action: "re_pin",
          instruction: `Unmapped source drift (${detail}). Refresh the pack pin against recorded merchant facts; do not guess a recovery.`,
        },
      },
    };
  }

  return {
    ok: true,
    classification,
    protocolAffecting: false,
    sdk,
    service,
    shaChanged,
    changes,
  };
}
