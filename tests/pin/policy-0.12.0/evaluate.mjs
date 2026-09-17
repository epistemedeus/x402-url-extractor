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

export function compareLockPackages(lockPackages, pins, { surface } = {}) {
  const failures = [];
  const name = pins.package;
  const root = lockPackages?.[""] ?? {};
  const declared = { ...root.dependencies, ...root.devDependencies };
  failures.push(...compareDeclared(declared, pins, {
    surface: surface ? `${surface}.lock-root` : "lock-root",
  }));
  const entry = lockPackages?.[`node_modules/${name}`];
  if (!entry) {
    addFailure(failures, {
      code: "lock-missing",
      surface,
      name,
      expected: pins.version,
      actual: null,
    });
    return failures;
  }
  if (entry.version !== pins.version) {
    addFailure(failures, {
      code: "lock-version-drift",
      surface,
      name,
      expected: pins.version,
      actual: entry.version ?? null,
    });
  }
  if (entry.integrity && pins.integrity && entry.integrity !== pins.integrity) {
    addFailure(failures, {
      code: "lock-integrity-drift",
      surface,
      name,
      expected: pins.integrity,
      actual: entry.integrity,
    });
  }
  if (entry.resolved && pins.resolved && entry.resolved !== pins.resolved) {
    addFailure(failures, {
      code: "lock-resolved-drift",
      surface,
      name,
      expected: pins.resolved,
      actual: entry.resolved,
    });
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
  if (source.declared) {
    failures.push(...compareDeclared(source.declared, pins, {
      surface: source.id ?? source.label ?? "declared",
    }));
  }
  if (source.lockPackages) {
    failures.push(...compareLockPackages(source.lockPackages, pins, {
      surface: source.id ?? source.label ?? "lock",
    }));
  }
  if (Array.isArray(source.surfaces)) {
    for (const surface of source.surfaces) {
      failures.push(...evaluatePinSource(surface, pins).failures);
    }
  }
  if (Array.isArray(source.sourceConsts)) {
    for (const item of source.sourceConsts) {
      failures.push(...compareSourceConst(item.source, item, { surface: item.id }));
    }
  }
  const ok = failures.length === 0;
  return {
    ok,
    code: ok ? "pins-match" : "pin-drift",
    label: source.label ?? source.id ?? null,
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
    return { kind: "projection", fixture };
  }
  return evaluatePinSource(fixture, pins);
}
