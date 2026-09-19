import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PIN_DIR = HERE;
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const PINS_PATH = join(HERE, "pins.json");
export const PACKAGE_NAME = "agent-payment-policy";

export function loadPins(path = PINS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function declaredFromPackage(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function addFailure(failures, failure) {
  failures.push(failure);
}

export function pinRecord(pins = loadPins()) {
  return Object.freeze({
    package: pins.package,
    expected: pins.version,
    inspectOutputSchema: false,
    buyerSchemaDigestRequires: pins.buyerSchemaDigest.requiresPolicy,
    omittedReason: pins.buyerSchemaDigest.omittedReason,
    r6_04: pins.buyerSchemaDigest.r6_04,
  });
}

export function compareDeclared(declared, pins, { surface } = {}) {
  const failures = [];
  const name = pins.package;
  const expected = pins.version;
  const actual = declared?.[name];
  if (actual !== expected) {
    addFailure(failures, {
      code: "version-drift",
      surface,
      name,
      expected,
      actual: actual ?? null,
    });
  }
  return failures;
}

export function lockPackageKeys(lockPackages, name) {
  return Object.keys(lockPackages || {}).filter((key) => (
    key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)
  ));
}

export function compareLockPackages(lockPackages, pins, { surface } = {}) {
  const failures = [];
  const name = pins.package;
  const root = lockPackages?.[""] ?? {};
  const declared = { ...root.dependencies, ...root.devDependencies };
  failures.push(...compareDeclared(declared, pins, {
    surface: surface ? `${surface}.lock-root` : "lock-root",
  }));
  const keys = lockPackageKeys(lockPackages, name);
  if (!keys.length) {
    addFailure(failures, {
      code: "lock-missing",
      surface,
      name,
      expected: pins.version,
      actual: null,
    });
    return failures;
  }
  for (const key of keys) {
    const entry = lockPackages[key] ?? {};
    const entrySurface = surface ? `${surface}:${key}` : key;
    if (entry.version !== pins.version) {
      addFailure(failures, {
        code: "lock-version-drift",
        surface: entrySurface,
        name,
        expected: pins.version,
        actual: entry.version ?? null,
      });
    }
    if (!entry.integrity) {
      addFailure(failures, {
        code: "lock-integrity-missing",
        surface: entrySurface,
        name,
        expected: pins.integrity,
        actual: null,
      });
    } else if (pins.integrity && entry.integrity !== pins.integrity) {
      addFailure(failures, {
        code: "lock-integrity-drift",
        surface: entrySurface,
        name,
        expected: pins.integrity,
        actual: entry.integrity,
      });
    }
    if (!entry.resolved) {
      addFailure(failures, {
        code: "lock-resolved-missing",
        surface: entrySurface,
        name,
        expected: pins.resolved,
        actual: null,
      });
    } else if (pins.resolved && entry.resolved !== pins.resolved) {
      addFailure(failures, {
        code: "lock-resolved-drift",
        surface: entrySurface,
        name,
        expected: pins.resolved,
        actual: entry.resolved,
      });
    }
  }
  return failures;
}

export function compareSourceConst(source, pinsConst, { surface } = {}) {
  const failures = [];
  if (!String(source).includes(pinsConst.pattern)) {
    addFailure(failures, {
      code: "source-const-drift",
      surface,
      name: pinsConst.id,
      expected: pinsConst.pattern,
      actual: null,
    });
  }
  return failures;
}

export function loadRepoPinSource(repoRoot = REPO_ROOT, pins = loadPins()) {
  const surfaces = [];
  for (const surface of pins.surfaces) {
    const pkgPath = join(repoRoot, surface.packageJson);
    const lockPath = join(repoRoot, surface.lockfile);
    const pkg = readJson(pkgPath);
    const lock = readJson(lockPath);
    surfaces.push({
      id: surface.id,
      declared: declaredFromPackage(pkg),
      lockPackages: lock.packages ?? {},
    });
  }
  const sourceConsts = [];
  for (const item of pins.sourceConsts ?? []) {
    sourceConsts.push({
      id: item.id,
      path: item.path,
      pattern: item.pattern,
      source: readFileSync(join(repoRoot, item.path), "utf8"),
    });
  }
  return { surfaces, sourceConsts };
}

export function evaluatePinSource(source, pins = loadPins()) {
  const failures = [];
  const body = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const hasSurfaces = Array.isArray(body.surfaces);
  const hasDeclared = Boolean(body.declared);
  const hasLock = Boolean(body.lockPackages);
  const hasConsts = Array.isArray(body.sourceConsts);
  if (!hasSurfaces && !hasDeclared && !hasLock && !hasConsts) {
    addFailure(failures, {
      code: "pin-source-empty",
      surface: body.id ?? body.label ?? null,
      name: pins.package,
      expected: pins.version,
      actual: null,
    });
  }
  if (hasDeclared && !hasLock && !hasSurfaces) {
    addFailure(failures, {
      code: "lock-missing",
      surface: body.id ?? body.label ?? "declared",
      name: pins.package,
      expected: pins.version,
      actual: null,
    });
  }
  if (hasDeclared) {
    failures.push(...compareDeclared(body.declared, pins, {
      surface: body.id ?? body.label ?? "declared",
    }));
  }
  if (hasLock) {
    failures.push(...compareLockPackages(body.lockPackages, pins, {
      surface: body.id ?? body.label ?? "lock",
    }));
  }
  if (hasSurfaces) {
    for (const surface of body.surfaces) {
      failures.push(...evaluatePinSource(surface, pins).failures);
    }
  }
  if (hasConsts) {
    for (const item of body.sourceConsts) {
      failures.push(...compareSourceConst(item.source, item, { surface: item.id }));
    }
  }
  const ok = failures.length === 0;
  return {
    ok,
    code: ok ? "pins-match" : "pin-drift",
    label: body.label ?? body.id ?? null,
    package: pins.package,
    version: pins.version,
    pin: pinRecord(pins),
    failures,
  };
}

export function evaluateRepoPins(repoRoot = REPO_ROOT, pins = loadPins()) {
  return evaluatePinSource(loadRepoPinSource(repoRoot, pins), pins);
}

export async function inspectInstalledPolicy(repoRoot = REPO_ROOT, pins = loadPins()) {
  const pkgPath = join(repoRoot, "node_modules", pins.package, "package.json");
  if (!existsSync(pkgPath)) {
    return { installed: false, package: pins.package, expected: pins.version };
  }
  const pkg = readJson(pkgPath);
  const corePath = join(repoRoot, "node_modules", pins.package, "core.mjs");
  const mod = existsSync(corePath) ? await import(pathToFileURL(corePath).href) : {};
  const failures = [];
  if (pkg.version !== pins.version) {
    failures.push({
      code: "installed-version-drift",
      name: pins.package,
      expected: pins.version,
      actual: pkg.version,
    });
  }
  for (const name of pins.exports.absent) {
    if (typeof mod[name] !== "undefined") {
      failures.push({
        code: "export-present-on-pin",
        name,
        expected: "undefined",
        actual: typeof mod[name],
      });
    }
  }
  for (const name of pins.exports.present) {
    if (typeof mod[name] !== "function") {
      failures.push({
        code: "export-missing-on-pin",
        name,
        expected: "function",
        actual: typeof mod[name],
      });
    }
  }
  const ok = failures.length === 0;
  return {
    installed: true,
    ok,
    code: ok ? "installed-pin-matches" : "installed-pin-drift",
    package: pins.package,
    version: pkg.version,
    inspectOutputSchema: typeof mod.inspectOutputSchema,
    prepareOutputValidator: typeof mod.prepareOutputValidator,
    evaluateResponseContract: typeof mod.evaluateResponseContract,
    failures,
  };
}

export function evaluateFixture(fixture, pins = loadPins()) {
  if (fixture?.kind === "projection") {
    return { ok: false, code: "projection-not-a-pin-source", kind: "projection", fixture };
  }
  return evaluatePinSource(fixture, pins);
}
