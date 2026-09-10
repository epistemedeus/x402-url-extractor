/**
 * Detect lockfile / manifest version disagreement.
 * Parsers are heuristic (no YAML library). Unparseable lockfile ⇒ unknown.
 */

const DIRECT_DEP_FIELDS = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"];

export function collectManifestPins(manifest) {
  const pins = new Map();
  if (!manifest || typeof manifest !== "object") return pins;
  for (const field of DIRECT_DEP_FIELDS) {
    const block = manifest[field];
    if (!block || typeof block !== "object") continue;
    for (const [name, spec] of Object.entries(block)) {
      if (typeof name === "string" && typeof spec === "string") {
        pins.set(name, { field, spec });
      }
    }
  }
  return pins;
}

export function parsePackageLock(text) {
  const versions = new Map();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: "package_lock_invalid_json", versions };
  }
  if (body && body.packages && typeof body.packages === "object") {
    for (const [pkgPath, meta] of Object.entries(body.packages)) {
      if (!meta || typeof meta !== "object") continue;
      if (pkgPath === "") continue;
      const name = packageLockName(pkgPath, meta);
      if (name && typeof meta.version === "string") versions.set(name, meta.version);
    }
  }
  if (body && body.dependencies && typeof body.dependencies === "object") {
    for (const [name, meta] of Object.entries(body.dependencies)) {
      if (meta && typeof meta.version === "string" && !versions.has(name)) {
        versions.set(name, meta.version);
      }
    }
  }
  return { ok: true, versions };
}

export function parseYarnLock(text) {
  const versions = new Map();
  if (typeof text !== "string") return { ok: false, reason: "yarn_lock_not_text", versions };
  let currentNames = [];
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith(" ") && line.includes("@") && line.trim().endsWith(":")) {
      const keys = line
        .trim()
        .slice(0, -1)
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""));
      currentNames = keys.map(yarnKeyName).filter(Boolean);
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith("version ") || trimmed.startsWith("version:")) {
      const v = trimmed
        .replace(/^version:?\s*/, "")
        .replace(/^"/, "")
        .replace(/"$/, "");
      for (const name of currentNames) {
        if (!versions.has(name)) versions.set(name, v);
      }
    }
  }
  return { ok: true, versions, coverage: "heuristic_yarn_v1" };
}

export function parsePnpmLock(text) {
  const versions = new Map();
  if (typeof text !== "string") return { ok: false, reason: "pnpm_lock_not_text", versions };
  // Heuristic: under importers.:.dependencies, a package name line followed by version:.
  const lines = text.split(/\n/);
  let inImporterDeps = false;
  let currentName = null;
  let indentOfName = 0;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*importers:\s*$/.test(line)) {
      inImporterDeps = false;
      continue;
    }
    if (inImporterDeps === false && /^\s{2,4}\.:\s*$/.test(line)) {
      continue;
    }
    if (/^\s+dependencies:\s*$/.test(line)) {
      inImporterDeps = true;
      currentName = null;
      continue;
    }
    if (inImporterDeps && /^\S/.test(line)) {
      inImporterDeps = false;
      currentName = null;
      continue;
    }
    if (inImporterDeps && /^\s{2,}packages:\s*$/.test(line)) {
      inImporterDeps = false;
      currentName = null;
      continue;
    }
    if (inImporterDeps) {
      const nameMatch = line.match(/^(\s+)([@A-Za-z0-9._/-]+):\s*$/);
      if (nameMatch && !["specifier", "version", "resolution"].includes(nameMatch[2])) {
        currentName = nameMatch[2];
        indentOfName = nameMatch[1].length;
        continue;
      }
      const verMatch = line.match(/^(\s+)version:\s*(.+)\s*$/);
      if (verMatch && currentName && verMatch[1].length > indentOfName) {
        const v = verMatch[2].replace(/^['"]|['"]$/g, "");
        versions.set(currentName, v);
        currentName = null;
      }
    }
  }
  return { ok: true, versions, coverage: "heuristic_pnpm_importer_deps" };
}

export function detectLockfileDisagreement({ manifestPins, sources }) {
  const findings = [];
  const names = new Set(manifestPins.keys());
  for (const src of sources) {
    if (src.versions) for (const name of src.versions.keys()) names.add(name);
    if (src.ok === false) {
      findings.push({
        kind: "lockfile_unparseable",
        file: src.file,
        reason: src.reason,
        decision: "unknown",
        coverage: "unknown",
      });
    }
  }

  for (const name of names) {
    const versions = {};
    if (manifestPins.has(name)) versions["package.json"] = manifestPins.get(name).spec;
    for (const src of sources) {
      if (src.ok && src.versions.has(name)) versions[src.file] = src.versions.get(name);
    }
    const unique = new Set(Object.values(versions).map(normalizeVersionToken));
    if (unique.size > 1) {
      findings.push({
        kind: "lockfile_disagreement",
        name,
        versions,
        decision: "unknown",
        rationale: "Alias/workspace/lockfile disagreement ⇒ unknown until resolved (packet rule 5)",
      });
    }
  }

  return findings;
}

function packageLockName(pkgPath, meta) {
  if (typeof meta.name === "string") return meta.name;
  const parts = String(pkgPath).split("node_modules/");
  return parts[parts.length - 1] || null;
}

function yarnKeyName(key) {
  const k = String(key).replace(/^"|"$/g, "");
  if (k.startsWith("@")) {
    const idx = k.indexOf("@", 1);
    return idx === -1 ? k : k.slice(0, idx);
  }
  const idx = k.indexOf("@");
  return idx === -1 ? k : k.slice(0, idx);
}

function normalizeVersionToken(v) {
  return String(v).trim().replace(/^v/, "").replace(/^['"]|['"]$/g, "");
}
