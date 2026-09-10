/** S122-compatible core x.y.z classifier. Ranges and non-core strings → unknown. */

const CORE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export function parseSemver(version) {
  if (typeof version !== "string" || !version.trim()) return null;
  const match = version.trim().match(CORE);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: version.trim(),
  };
}

export function classifySemverDelta(before, after) {
  if (before == null && after == null) return "none";
  if (before === after) return "none";
  const left = parseSemver(before);
  const right = parseSemver(after);
  if (!left || !right) return "unknown";
  if (right.major !== left.major) return "major";
  if (right.minor !== left.minor) return "minor";
  if (right.patch !== left.patch) return "patch";
  return "none";
}
