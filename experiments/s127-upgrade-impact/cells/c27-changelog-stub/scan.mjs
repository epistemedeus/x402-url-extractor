/**
 * Coarse changelog keyword skim.
 *
 * Not a Keep-a-Changelog parser, not a markdown AST, not TypeScript.
 * Over-matching is acceptable: this baseline is weaker than usage binding.
 */

export const MAX_CHANGELOG_CHARS = 256 * 1024;

const PATTERNS = Object.freeze({
  breaking: /\b(?:breaking(?:\s+changes?)?|break(?:s|ing)?\s+compatibility|incompatible|not backwards compatible|backwards? incompatible|esm[- ]only)\b/i,
  removed: /\b(?:removed?|removes|removing|dropped?|drops|dropping|deleted?|deletes|deleting)\b/i,
  renamed: /\b(?:renamed?|renames|renaming)\b/i,
  added: /\b(?:added?|adds|adding)\b/i,
  fix: /\b(?:fix(?:ed|es|ing)?|bugfix(?:es)?|hotfix(?:es)?)\b/i,
  docs: /\b(?:docs?|documentation)\b/i,
  perf: /\b(?:perf(?:ormance)?|optimiz(?:e|ed|es|ing|ation)|faster)\b/i,
});

export function extractChangelogText(input) {
  if (input == null) {
    return emptyExtract("missing");
  }
  if (typeof input === "string") {
    return finishExtract(input, { coverage: "full" });
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return emptyExtract("unknown");
  }

  const direct =
    pickString(input.text) ||
    pickString(input.body) ||
    pickString(input.notes) ||
    pickString(input.changelogText) ||
    pickString(input.releaseNotes);
  if (direct) {
    const coverage = input.coverage === "partial" || input.truncated === true ? "partial" : "full";
    return finishExtract(direct, {
      coverage,
      path: pickString(input.path) || null,
      url: pickString(input.url) || null,
      retrievedAt: pickString(input.retrievedAt) || null,
      label: pickLabel(input.label || input.evidenceClass),
    });
  }

  if (Array.isArray(input.releases)) {
    const parts = [];
    for (const row of input.releases) {
      if (typeof row === "string") {
        if (row.trim()) parts.push(row.trim());
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const tag = pickString(row.tag_name) || pickString(row.tag) || pickString(row.name);
      const body = pickString(row.body) || pickString(row.text) || pickString(row.notes);
      if (!body) continue;
      parts.push(tag ? `## ${tag}\n${body}` : body);
    }
    if (parts.length === 0) {
      return emptyExtract("missing", {
        path: pickString(input.path) || null,
        url: pickString(input.url) || null,
        retrievedAt: pickString(input.retrievedAt) || null,
        label: pickLabel(input.label || input.evidenceClass),
      });
    }
    return finishExtract(parts.join("\n\n"), {
      coverage: "partial",
      path: pickString(input.path) || null,
      url: pickString(input.url) || null,
      retrievedAt: pickString(input.retrievedAt) || null,
      label: pickLabel(input.label || input.evidenceClass),
    });
  }

  if (pickString(input.path) || pickString(input.url)) {
    return emptyExtract("missing", {
      path: pickString(input.path) || null,
      url: pickString(input.url) || null,
      retrievedAt: pickString(input.retrievedAt) || null,
      label: pickLabel(input.label || input.evidenceClass),
    });
  }

  return emptyExtract("missing");
}

export function scanChangelogSignals(text) {
  const raw = typeof text === "string" ? text : "";
  const signals = {
    breaking: PATTERNS.breaking.test(raw),
    removed: PATTERNS.removed.test(raw),
    renamed: PATTERNS.renamed.test(raw),
    added: PATTERNS.added.test(raw),
    fix: PATTERNS.fix.test(raw),
    docs: PATTERNS.docs.test(raw),
    perf: PATTERNS.perf.test(raw),
  };
  const breakingLike = Boolean(signals.breaking || signals.removed || signals.renamed);
  const additiveOrMaintenance = Boolean(signals.added || signals.fix || signals.docs || signals.perf);
  return {
    ...signals,
    breakingLike,
    additiveOrMaintenance,
    classified: breakingLike || additiveOrMaintenance,
  };
}

function finishExtract(text, extra) {
  const truncated = text.length > MAX_CHANGELOG_CHARS;
  const value = truncated ? text.slice(0, MAX_CHANGELOG_CHARS) : text;
  const present = value.trim().length > 0;
  let coverage = "missing";
  if (present) {
    coverage = truncated ? "partial" : extra.coverage || "full";
  }
  return {
    present,
    text: present ? value : "",
    truncated,
    coverage,
    path: extra.path || null,
    url: extra.url || null,
    retrievedAt: extra.retrievedAt || null,
    label: extra.label || null,
  };
}

function emptyExtract(coverage, extra = {}) {
  return {
    present: false,
    text: "",
    truncated: false,
    coverage,
    path: extra.path || null,
    url: extra.url || null,
    retrievedAt: extra.retrievedAt || null,
    label: extra.label || null,
  };
}

function pickString(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function pickLabel(value) {
  if (value === "fixture" || value === "live-capture" || value === "synthetic") return value;
  return null;
}
