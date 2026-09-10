/**
 * Normalize npm registry metadata (slim extract or version document).
 * Dist-tags on a slim prior are capture-time hints and are never the observation version.
 * Full packuments may use dist-tags.latest as the current version.
 */

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function normalizeNpmObservation(doc, { role = "current" } = {}) {
  if (doc == null) {
    return {
      ok: false,
      code: "missing_document",
      message: "npm observation document is required",
    };
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, code: "invalid_document", message: "npm observation must be an object" };
  }

  const pkg = firstString(doc.package, doc.name);
  const isPackument = doc["dist-tags"] && typeof doc["dist-tags"] === "object" && doc.versions && typeof doc.versions === "object";

  let version = null;
  if (role === "current" && isPackument) {
    version = firstString(doc["dist-tags"].latest, doc.version);
  } else {
    version = firstString(doc.version);
  }

  let publishedAt = firstString(doc.published_at, doc.publishedAt);
  if (!publishedAt && version && doc.time && typeof doc.time === "object") {
    publishedAt = firstString(doc.time[version]);
  }

  let deprecated = null;
  if (Object.prototype.hasOwnProperty.call(doc, "deprecated")) {
    deprecated = doc.deprecated ?? null;
  } else if (isPackument && version && doc.versions[version] && Object.prototype.hasOwnProperty.call(doc.versions[version], "deprecated")) {
    deprecated = doc.versions[version].deprecated ?? null;
  }

  const engines =
    doc.engines && typeof doc.engines === "object"
      ? doc.engines
      : isPackument && version && doc.versions[version]?.engines
        ? doc.versions[version].engines
        : null;
  const bin = doc.bin ?? (isPackument && version ? doc.versions[version]?.bin ?? null : null);

  const coverage = {
    package: Boolean(pkg),
    version: Boolean(version),
    publishedAt: Boolean(publishedAt),
    deprecated: Object.prototype.hasOwnProperty.call(doc, "deprecated") || Boolean(isPackument && version && doc.versions?.[version] && Object.prototype.hasOwnProperty.call(doc.versions[version], "deprecated")),
  };

  return {
    ok: true,
    observation: {
      package: pkg,
      version,
      publishedAt,
      deprecated,
      engines,
      bin,
      coverage,
      packument: Boolean(isPackument),
    },
  };
}

export const NPM_COMPARE_FIELDS = Object.freeze(["version", "publishedAt", "deprecated"]);

export function requiredNpmCoverage(observation) {
  return Boolean(observation?.coverage?.package && observation?.coverage?.version && observation?.coverage?.publishedAt);
}
