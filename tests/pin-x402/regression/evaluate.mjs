import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REGRESSION_DIR = HERE;
export const PIN_DIR = HERE;
export const REPO_ROOT = join(HERE, "..", "..", "..");
export const PINS_PATH = join(HERE, "pins.json");
export const SEEDED_DRIFT_PATH = join(HERE, "fixtures", "seeded-drift.json");

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const RANGE_SPEC = /^(?:[~^><*=]|workspace:|file:|git\+|github:|https?:|latest|next|npm:)/;

export function loadPins(path = PINS_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function declaredFromPackage(pkg) {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

function isExactVersion(spec) {
  return typeof spec === "string" && EXACT_VERSION.test(spec);
}

function isRangeSpec(spec) {
  return typeof spec === "string" && !isExactVersion(spec) && (
    RANGE_SPEC.test(spec) || spec.includes(" - ") || spec.includes("||")
  );
}

export function compareDeclared(declared, pins, { surface, names, alsoDeclared = false } = {}) {
  const failures = [];
  const packages = names ?? Object.keys(pins.packages);
  for (const name of packages) {
    const expected = pins.packages[name]?.version;
    const actual = declared?.[name];
    if (actual == null) {
      failures.push({
        code: "version-missing",
        surface,
        name,
        expected,
        actual: null,
      });
      continue;
    }
    if (isRangeSpec(actual)) {
      failures.push({
        code: "range-pin",
        surface,
        name,
        expected,
        actual,
      });
      continue;
    }
    if (actual !== expected) {
      failures.push({
        code: "version-drift",
        surface,
        name,
        expected,
        actual,
      });
    }
  }
  if (alsoDeclared) {
    for (const [name, expected] of Object.entries(pins.alsoDeclared ?? {})) {
      const actual = declared?.[name];
      if (actual !== expected) {
        failures.push({
          code: "companion-drift",
          surface,
          name,
          expected,
          actual: actual ?? null,
        });
      }
    }
  }
  for (const name of pins.forbidden ?? []) {
    if (name in (declared ?? {})) {
      failures.push({
        code: "forbidden-package",
        surface,
        name,
        expected: null,
        actual: declared[name],
      });
    }
  }
  return failures;
}

export function compareLockPackages(lock, pins, { surface, names } = {}) {
  const failures = [];
  const packages = names ?? Object.keys(pins.packages);
  const lockPackages = lock?.packages ?? lock;
  const expectedLockfileVersion = pins.lockfileVersion ?? 3;
  if (lock && typeof lock.lockfileVersion === "number" && lock.lockfileVersion !== expectedLockfileVersion) {
    failures.push({
      code: "lockfile-version",
      surface,
      name: "lockfileVersion",
      expected: expectedLockfileVersion,
      actual: lock.lockfileVersion,
    });
  }
  const root = lockPackages?.[""] ?? {};
  const declared = { ...root.dependencies, ...root.devDependencies };
  failures.push(...compareDeclared(declared, pins, {
    surface: surface ? `${surface}.lock-root` : "lock-root",
    names: packages,
  }));
  for (const name of packages) {
    const expected = pins.packages[name];
    const entry = lockPackages?.[`node_modules/${name}`];
    if (!entry) {
      failures.push({
        code: "lock-missing",
        surface,
        name,
        expected: expected.version,
        actual: null,
      });
      continue;
    }
    if (entry.version !== expected.version) {
      failures.push({
        code: "lock-version-drift",
        surface,
        name,
        expected: expected.version,
        actual: entry.version ?? null,
      });
    }
    if (entry.integrity && expected.integrity && entry.integrity !== expected.integrity) {
      failures.push({
        code: "lock-integrity-drift",
        surface,
        name,
        expected: expected.integrity,
        actual: entry.integrity,
      });
    }
    if (entry.resolved && expected.resolved && entry.resolved !== expected.resolved) {
      failures.push({
        code: "lock-resolved-drift",
        surface,
        name,
        expected: expected.resolved,
        actual: entry.resolved,
      });
    }
  }
  for (const name of pins.forbidden ?? []) {
    if (`node_modules/${name}` in (lockPackages ?? {})) {
      failures.push({
        code: "forbidden-lock-package",
        surface,
        name,
        expected: null,
        actual: lockPackages[`node_modules/${name}`]?.version ?? true,
      });
    }
  }
  return failures;
}

export function compareInstalled(repoRoot, pins, { surface, names, nodeModules } = {}) {
  const failures = [];
  if (!nodeModules) return failures;
  const dir = join(repoRoot, nodeModules);
  if (!existsSync(dir)) {
    return [{
      code: "installed-absent",
      surface,
      name: nodeModules,
      expected: pins.x402,
      actual: null,
      advisory: true,
    }];
  }
  const packages = names ?? Object.keys(pins.packages);
  const expectedShort = packages.map((name) => name.slice("@x402/".length)).sort();
  const actualShort = readdirSync(dir).filter((name) => !name.startsWith(".")).sort();
  for (const short of actualShort) {
    const name = `@x402/${short}`;
    if ((pins.forbidden ?? []).includes(name)) {
      failures.push({
        code: "forbidden-installed",
        surface,
        name,
        expected: null,
        actual: true,
      });
    }
  }
  for (const short of expectedShort) {
    if (!actualShort.includes(short)) {
      failures.push({
        code: "installed-missing",
        surface,
        name: `@x402/${short}`,
        expected: pins.x402,
        actual: null,
      });
      continue;
    }
    const pkgPath = join(dir, short, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.version !== pins.x402) {
      failures.push({
        code: "installed-version-drift",
        surface,
        name: `@x402/${short}`,
        expected: pins.x402,
        actual: pkg.version ?? null,
      });
    }
  }
  return failures;
}

export function pythonX402Present(repoRoot = REPO_ROOT) {
  if (existsSync(join(repoRoot, "requirements.txt"))) {
    return /\bx402\s*==/.test(readFileSync(join(repoRoot, "requirements.txt"), "utf8"));
  }
  const pyproject = join(repoRoot, "integrations", "agentverse-a2a", "pyproject.toml");
  if (!existsSync(pyproject)) return false;
  return /\bx402\s*==/.test(readFileSync(pyproject, "utf8"));
}

export function loadRepoPinSource(repoRoot = REPO_ROOT, pins = loadPins()) {
  const surfaces = [];
  for (const surface of pins.surfaces) {
    const pkg = readJson(join(repoRoot, surface.packageJson));
    const lock = readJson(join(repoRoot, surface.lockfile));
    surfaces.push({
      id: surface.id,
      names: surface.packages,
      alsoDeclared: surface.alsoDeclared === true,
      nodeModules: surface.nodeModules,
      declared: declaredFromPackage(pkg),
      lock,
      lockPackages: lock.packages ?? {},
    });
  }
  return {
    id: "repo",
    label: "cold-repo",
    surfaces,
    pythonPresent: pythonX402Present(repoRoot),
  };
}

export function evaluatePinSource(source, pins = loadPins(), { failOnAbsentInstall = false } = {}) {
  const failures = [];
  if (source.declared) {
    failures.push(...compareDeclared(source.declared, pins, {
      surface: source.id ?? "declared",
      names: source.names,
      alsoDeclared: source.alsoDeclared === true,
    }));
  }
  if (source.lock || source.lockPackages) {
    failures.push(...compareLockPackages(source.lock ?? { packages: source.lockPackages }, pins, {
      surface: source.id ?? "lock",
      names: source.names,
    }));
  }
  if (Array.isArray(source.surfaces)) {
    for (const surface of source.surfaces) {
      failures.push(...evaluatePinSource(surface, pins, { failOnAbsentInstall }).failures);
    }
  }
  if (source.pythonPresent === true) {
    failures.push({
      code: "unexpected-python-x402",
      surface: source.id ?? "python",
      name: "x402",
      expected: null,
      actual: true,
    });
  }
  const blocking = failures.filter((failure) => failure.advisory !== true || failOnAbsentInstall);
  const ok = blocking.length === 0;
  return {
    ok,
    code: ok ? "pins-match" : "pin-drift",
    label: source.label ?? source.id ?? null,
    x402: pins.x402,
    failures: blocking,
    advisories: failures.filter((failure) => failure.advisory === true && !failOnAbsentInstall),
  };
}

export function evaluateRepoPins(repoRoot = REPO_ROOT, pins = loadPins(), options = {}) {
  const source = loadRepoPinSource(repoRoot, pins);
  const result = evaluatePinSource(source, pins, options);
  const installed = [];
  for (const surface of pins.surfaces) {
    if (!surface.nodeModules) continue;
    installed.push(...compareInstalled(repoRoot, pins, {
      surface: surface.id,
      names: surface.packages,
      nodeModules: surface.nodeModules,
    }));
  }
  const advisories = [
    ...(result.advisories ?? []),
    ...installed.filter((failure) => failure.code === "installed-absent"),
  ];
  const blockingInstalled = installed.filter((failure) => failure.code !== "installed-absent");
  const failures = [...result.failures, ...blockingInstalled];
  const ok = failures.length === 0;
  return {
    ...result,
    ok,
    code: ok ? "pins-match" : "pin-drift",
    failures,
    advisories,
    installed: advisories.some((item) => item.code === "installed-absent")
      ? "absent"
      : (blockingInstalled.length ? "drift" : "match"),
    surfaces: pins.surfaces.map((surface) => surface.id),
  };
}

export function assertExactBaseUsdcAccept(accept, pins, failures, label = "accept") {
  const expected = pins.sdsMcp;
  if (!accept || typeof accept !== "object" || Array.isArray(accept)) {
    failures.push({ code: "accept-missing", label, expected: "object", actual: accept ?? null });
    return;
  }
  if (accept.scheme !== expected.scheme) {
    failures.push({ code: "scheme-drift", label, expected: expected.scheme, actual: accept.scheme ?? null });
  }
  if (accept.scheme === "batch-settlement") {
    failures.push({ code: "batch-settlement", label, expected: expected.scheme, actual: accept.scheme });
  }
  if (accept.network !== expected.network) {
    failures.push({ code: "network-drift", label, expected: expected.network, actual: accept.network ?? null });
  }
  if (accept.asset !== expected.asset) {
    failures.push({ code: "asset-drift", label, expected: expected.asset, actual: accept.asset ?? null });
  }
  if (accept.payTo !== expected.payTo) {
    failures.push({ code: "payto-drift", label, expected: expected.payTo, actual: accept.payTo ?? null });
  }
  if (!/^[0-9]+$/.test(String(accept.amount ?? "")) || BigInt(accept.amount) <= 0n) {
    failures.push({
      code: "amount-invalid",
      label,
      expected: "positive integer string",
      actual: accept.amount ?? null,
    });
  }
  const extra = accept.extra && typeof accept.extra === "object" ? accept.extra : {};
  if ("minDeposit" in extra) {
    failures.push({ code: "min-deposit", label, expected: null, actual: extra.minDeposit });
  }
}

export function evaluateSds402(paymentRequired, pins = loadPins(), label = "sds-402") {
  const failures = [];
  if (!paymentRequired || typeof paymentRequired !== "object" || Array.isArray(paymentRequired)) {
    return {
      ok: false,
      code: "sds-402-invalid",
      label,
      parseSuccess: false,
      paid: false,
      failures: [{ code: "payment-required-missing", label, expected: "object", actual: paymentRequired ?? null }],
    };
  }
  const expectedVersion = pins.sdsMcp?.x402Version ?? 2;
  if (paymentRequired.x402Version !== expectedVersion) {
    failures.push({
      code: "x402-version-drift",
      label,
      expected: expectedVersion,
      actual: paymentRequired.x402Version ?? null,
    });
  }
  const accepts = paymentRequired.accepts;
  if (!Array.isArray(accepts) || accepts.length < 1) {
    failures.push({
      code: "accepts-empty",
      label,
      expected: ">=1",
      actual: Array.isArray(accepts) ? accepts.length : null,
    });
  } else {
    for (const [index, accept] of accepts.entries()) {
      assertExactBaseUsdcAccept(accept, pins, failures, `${label}.accepts[${index}]`);
    }
  }
  const tags = paymentRequired.resource?.tags;
  const maxTags = pins.sdsMcp?.maxTags ?? 5;
  if (Array.isArray(tags) && tags.length > maxTags) {
    failures.push({
      code: "resource-tags-too-big",
      label,
      expected: maxTags,
      actual: tags.length,
    });
  }
  const raw = JSON.stringify(paymentRequired);
  if (raw.includes("batch-settlement")) {
    failures.push({ code: "batch-settlement", label, expected: false, actual: true });
  }
  if (raw.includes("minDeposit")) {
    failures.push({ code: "min-deposit", label, expected: false, actual: true });
  }
  const ok = failures.length === 0;
  return {
    ok,
    code: ok ? "sds-402-valid" : "sds-402-invalid",
    label,
    parseSuccess: ok,
    paid: false,
    x402Version: paymentRequired.x402Version ?? null,
    accepts: Array.isArray(accepts) ? accepts : [],
    failures,
  };
}

export function evaluateFixture(fixture, pins = loadPins()) {
  if (fixture.kind === "sds-402") {
    return evaluateSds402(fixture.paymentRequired ?? fixture, pins, fixture.label);
  }
  return evaluatePinSource(fixture, pins);
}
