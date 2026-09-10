import {
  ERROR_CODES,
  FORBIDDEN_FIELDS,
  INPUT_SCHEMA,
  UNKNOWN_LICENSE,
} from "./constants.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function reportError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details !== undefined) err.details = details;
  return err;
}

function requireNonEmptyString(value, label, { max = 2000 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be a non-empty string`);
  }
  if (value.length > max) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} exceeds max length ${max}`);
  }
  return value.trim();
}

export function assertNoForbidden(record, label) {
  if (!isPlainObject(record)) return;
  for (const key of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw reportError(
        ERROR_CODES.FORBIDDEN_CLAIM,
        `${label} declares forbidden field ${key}`,
        { field: key },
      );
    }
  }
  for (const [k, v] of Object.entries(record)) {
    if (isPlainObject(v)) assertNoForbidden(v, `${label}.${k}`);
    else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (isPlainObject(item)) assertNoForbidden(item, `${label}.${k}[${i}]`);
      });
    }
  }
}

/**
 * Normalize one dependency entry.
 * Incomplete when name or version is missing (partial_input path).
 * License missing → unknown (never invent SPDX).
 */
export function validateDependencyEntry(raw, index = 0, treeLabel = "dependencies") {
  const label = `${treeLabel}[${index}]`;
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const nameRaw = raw.name ?? raw.package ?? null;
  const versionRaw = raw.version ?? raw.ver ?? null;

  const hasName = nameRaw != null && String(nameRaw).trim() !== "";
  const hasVersion = versionRaw != null && String(versionRaw).trim() !== "";

  const name = hasName
    ? requireNonEmptyString(String(nameRaw), `${label}.name`, { max: 256 })
    : null;
  const version = hasVersion
    ? requireNonEmptyString(String(versionRaw), `${label}.version`, { max: 128 })
    : null;

  let license = UNKNOWN_LICENSE;
  let licenseDeclared = false;
  if (raw.license != null) {
    const lic = String(raw.license).trim();
    if (lic) {
      license = lic.slice(0, 240);
      licenseDeclared = true;
    }
  } else if (raw.licenses != null) {
    // Accept common alternate shapes without inventing SPDX ids.
    if (typeof raw.licenses === "string" && raw.licenses.trim()) {
      license = raw.licenses.trim().slice(0, 240);
      licenseDeclared = true;
    } else if (Array.isArray(raw.licenses) && raw.licenses.length > 0) {
      const parts = raw.licenses
        .map((x) => {
          if (typeof x === "string") return x.trim();
          if (isPlainObject(x) && x.type) return String(x.type).trim();
          return "";
        })
        .filter(Boolean);
      if (parts.length) {
        license = parts.join(" OR ").slice(0, 240);
        licenseDeclared = true;
      }
    }
  }

  const dev = raw.dev === true || raw.development === true || raw.devDependency === true;

  // Incomplete: missing required identity fields.
  const incomplete = !hasName || !hasVersion;

  return {
    name,
    version,
    license,
    licenseDeclared,
    licenseUnknown: !licenseDeclared,
    dev,
    incomplete,
    path: raw.path == null ? null : String(raw.path).slice(0, 500),
  };
}

/**
 * Expand npm package-lock style summary into normalized entries.
 * Accepts:
 *   - dependencies: [{name,version,license,dev?}, ...]
 *   - packages: { "": {...}, "node_modules/foo": {version,license,dev?} }
 *   - lockfile.packages / lockfile.dependencies (nested one level)
 */
export function expandTreeDependencies(rawTree, treeLabel = "tree") {
  if (Array.isArray(rawTree.dependencies)) {
    return rawTree.dependencies.map((d, i) =>
      validateDependencyEntry(d, i, `${treeLabel}.dependencies`),
    );
  }

  // Normalized packages map (npm lock v2/v3 style summary).
  const packagesObj =
    isPlainObject(rawTree.packages)
      ? rawTree.packages
      : isPlainObject(rawTree.lockfile) && isPlainObject(rawTree.lockfile.packages)
        ? rawTree.lockfile.packages
        : null;

  if (packagesObj) {
    const entries = [];
    let i = 0;
    for (const [key, meta] of Object.entries(packagesObj)) {
      if (key === "" || key === ".") continue; // root package metadata
      if (!isPlainObject(meta)) {
        throw reportError(
          ERROR_CODES.INVALID_INPUT,
          `${treeLabel}.packages[${key}] must be an object`,
        );
      }
      const name =
        meta.name != null
          ? meta.name
          : key.replace(/^node_modules\//, "").replace(/\/node_modules\//g, "/");
      // For nested node_modules paths, take the last segment chain carefully.
      let derivedName = name;
      if (meta.name == null && key.includes("node_modules/")) {
        const parts = key.split("node_modules/").filter(Boolean);
        derivedName = parts[parts.length - 1];
      }
      entries.push(
        validateDependencyEntry(
          {
            name: derivedName,
            version: meta.version,
            license: meta.license,
            licenses: meta.licenses,
            dev: meta.dev,
            path: key,
          },
          i++,
          `${treeLabel}.packages`,
        ),
      );
    }
    return entries;
  }

  // Object-map of name -> version string or {version, license, dev}
  if (isPlainObject(rawTree.dependencies)) {
    const entries = [];
    let i = 0;
    for (const [name, meta] of Object.entries(rawTree.dependencies)) {
      if (typeof meta === "string") {
        entries.push(
          validateDependencyEntry({ name, version: meta }, i++, `${treeLabel}.dependencies`),
        );
      } else if (isPlainObject(meta)) {
        entries.push(
          validateDependencyEntry(
            {
              name,
              version: meta.version ?? meta.ver,
              license: meta.license,
              licenses: meta.licenses,
              dev: meta.dev,
            },
            i++,
            `${treeLabel}.dependencies`,
          ),
        );
      } else {
        throw reportError(
          ERROR_CODES.INVALID_INPUT,
          `${treeLabel}.dependencies[${name}] must be string or object`,
        );
      }
    }
    return entries;
  }

  throw reportError(
    ERROR_CODES.MISSING_REQUIREMENT,
    `${treeLabel} needs dependencies[] or packages{} inventory`,
  );
}

export function validateTree(raw, index = 0) {
  const label = `trees[${index}]`;
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, `${label} must be an object`);
  }
  assertNoForbidden(raw, label);

  const id = requireNonEmptyString(
    String(raw.id ?? raw.treeId ?? raw.label ?? `tree-${index}`),
    `${label}.id`,
    { max: 128 },
  );
  const treeLabel =
    raw.label == null
      ? id
      : requireNonEmptyString(String(raw.label), `${label}.label`, { max: 240 });

  const lockfileFormat =
    raw.lockfileFormat == null
      ? null
      : requireNonEmptyString(String(raw.lockfileFormat), `${label}.lockfileFormat`, {
          max: 64,
        });

  const dependencies = expandTreeDependencies(raw, label);
  if (dependencies.length < 1) {
    throw reportError(
      ERROR_CODES.MISSING_REQUIREMENT,
      `${label} needs at least one dependency entry`,
    );
  }

  return {
    id,
    label: treeLabel,
    lockfileFormat,
    dependencies,
  };
}

/**
 * Validate full dependency-footprint input (one or more trees).
 */
export function validateDependencyFootprintInput(raw) {
  if (!isPlainObject(raw)) {
    throw reportError(ERROR_CODES.INVALID_INPUT, "dependency footprint input must be an object");
  }
  assertNoForbidden(raw, "input");

  if (raw.schema != null && raw.schema !== INPUT_SCHEMA) {
    throw reportError(
      ERROR_CODES.INVALID_INPUT,
      `input.schema must be ${INPUT_SCHEMA} when present`,
    );
  }

  let treesRaw = raw.trees;
  if (treesRaw == null && (raw.dependencies != null || raw.packages != null)) {
    // Single-tree shorthand.
    treesRaw = [
      {
        id: raw.treeId ?? raw.id ?? "default",
        label: raw.label ?? raw.title ?? "default",
        lockfileFormat: raw.lockfileFormat,
        dependencies: raw.dependencies,
        packages: raw.packages,
        lockfile: raw.lockfile,
      },
    ];
  }

  if (!Array.isArray(treesRaw) || treesRaw.length < 1) {
    throw reportError(
      ERROR_CODES.MISSING_REQUIREMENT,
      "trees[] is required (at least one lockfile / inventory snapshot)",
    );
  }

  const trees = treesRaw.map((t, i) => validateTree(t, i));

  const seenIds = new Map();
  for (const t of trees) {
    if (seenIds.has(t.id)) {
      throw reportError(
        ERROR_CODES.INVALID_INPUT,
        `duplicate tree id ${t.id}`,
        { treeId: t.id },
      );
    }
    seenIds.set(t.id, true);
  }

  const reportId = requireNonEmptyString(raw.reportId ?? raw.id ?? "unnamed-report", "reportId", {
    max: 128,
  });

  return {
    schema: INPUT_SCHEMA,
    reportId,
    title:
      raw.title == null
        ? null
        : requireNonEmptyString(String(raw.title), "title", { max: 240 }),
    trees,
    demo: raw.demo === true,
    sourceLabel:
      raw.sourceLabel == null
        ? null
        : requireNonEmptyString(String(raw.sourceLabel), "sourceLabel", { max: 240 }),
  };
}
