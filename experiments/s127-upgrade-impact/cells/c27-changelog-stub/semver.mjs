/**
 * Tiny semver identity/delta for the changelog-only baseline.
 * Not a full semver implementation. Prerelease/build are identity, not order.
 */

const CORE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(version) {
  if (typeof version !== "string" || !version.trim()) return null;
  const match = version.trim().match(CORE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
    build: match[5] || "",
    raw: version.trim(),
  };
}

/**
 * @returns {"same"|"different"|"prerelease_or_build_diff"|"unknown"}
 */
export function versionIdentity(oldVersion, newVersion) {
  const leftRaw = readVersion(oldVersion);
  const rightRaw = readVersion(newVersion);
  if (!leftRaw || !rightRaw) return "unknown";
  if (leftRaw === rightRaw) return "same";
  const left = parseSemver(leftRaw);
  const right = parseSemver(rightRaw);
  if (!left || !right) return "unknown";
  if (left.major === right.major && left.minor === right.minor && left.patch === right.patch) {
    if (left.prerelease !== right.prerelease || left.build !== right.build) {
      return "prerelease_or_build_diff";
    }
    return "same";
  }
  return "different";
}

/**
 * @returns {"none"|"major"|"minor"|"patch"|"unknown"}
 */
export function classifySemverDelta(oldVersion, newVersion) {
  const identity = versionIdentity(oldVersion, newVersion);
  if (identity === "same") return "none";
  if (identity === "unknown" || identity === "prerelease_or_build_diff") return "unknown";
  const left = parseSemver(readVersion(oldVersion));
  const right = parseSemver(readVersion(newVersion));
  if (!left || !right) return "unknown";
  if (right.major !== left.major) return "major";
  if (right.minor !== left.minor) return "minor";
  if (right.patch !== left.patch) return "patch";
  return "none";
}

function readVersion(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
