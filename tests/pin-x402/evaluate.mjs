import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePaymentRequired } from "@x402/core/schemas";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PIN_DIR = HERE;
export const REPO_ROOT = join(HERE, "..", "..");
export const PINS_PATH = join(HERE, "pins.json");

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

export function compareDeclared(declared, pins, { surface, names } = {}) {
  const failures = [];
  const packages = names ?? Object.keys(pins.packages);
  for (const name of packages) {
    const expected = pins.packages[name]?.version;
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
  }
  for (const name of pins.forbidden ?? []) {
    if (name in (declared ?? {})) {
      addFailure(failures, {
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

export function compareLockPackages(lockPackages, pins, { surface, names } = {}) {
  const failures = [];
  const packages = names ?? Object.keys(pins.packages);
  const root = lockPackages?.[""] ?? {};
  const declared = { ...root.dependencies, ...root.devDependencies };
  failures.push(...compareDeclared(declared, pins, { surface: surface ? `${surface}.lock-root` : "lock-root", names: packages }));
  for (const name of packages) {
    const expected = pins.packages[name];
    const entry = lockPackages?.[`node_modules/${name}`];
    if (!entry) {
      addFailure(failures, {
        code: "lock-missing",
        surface,
        name,
        expected: expected.version,
        actual: null,
      });
      continue;
    }
    if (entry.version !== expected.version) {
      addFailure(failures, {
        code: "lock-version-drift",
        surface,
        name,
        expected: expected.version,
        actual: entry.version ?? null,
      });
    }
    if (entry.integrity && expected.integrity && entry.integrity !== expected.integrity) {
      addFailure(failures, {
        code: "lock-integrity-drift",
        surface,
        name,
        expected: expected.integrity,
        actual: entry.integrity,
      });
    }
    if (entry.resolved && expected.resolved && entry.resolved !== expected.resolved) {
      addFailure(failures, {
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
      addFailure(failures, {
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

export function loadRepoPinSource(repoRoot = REPO_ROOT, pins = loadPins()) {
  const surfaces = [];
  for (const surface of pins.surfaces) {
    const pkgPath = join(repoRoot, surface.packageJson);
    const lockPath = join(repoRoot, surface.lockfile);
    const pkg = readJson(pkgPath);
    const lock = readJson(lockPath);
    surfaces.push({
      id: surface.id,
      names: surface.packages,
      declared: declaredFromPackage(pkg),
      lockPackages: lock.packages ?? {},
    });
  }
  return { surfaces };
}

export function evaluatePinSource(source, pins = loadPins()) {
  const failures = [];
  if (source.declared) {
    failures.push(...compareDeclared(source.declared, pins, {
      surface: source.id ?? "declared",
      names: source.names,
    }));
  }
  if (source.lockPackages) {
    failures.push(...compareLockPackages(source.lockPackages, pins, {
      surface: source.id ?? "lock",
      names: source.names,
    }));
  }
  if (Array.isArray(source.surfaces)) {
    for (const surface of source.surfaces) {
      failures.push(...evaluatePinSource(surface, pins).failures);
    }
  }
  const ok = failures.length === 0;
  return {
    ok,
    code: ok ? "pins-match" : "pin-drift",
    label: source.label ?? source.id ?? null,
    x402: pins.x402,
    failures,
  };
}

export function evaluateRepoPins(repoRoot = REPO_ROOT, pins = loadPins()) {
  return evaluatePinSource(loadRepoPinSource(repoRoot, pins), pins);
}

export function evaluateFixture(fixture, pins = loadPins()) {
  if (fixture.kind === "sds-402") {
    return evaluateSds402(fixture.paymentRequired ?? fixture, pins, fixture.label);
  }
  return evaluatePinSource(fixture, pins);
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
    failures.push({ code: "amount-invalid", label, expected: "positive integer string", actual: accept.amount ?? null });
  }
  const extra = accept.extra && typeof accept.extra === "object" ? accept.extra : {};
  if ("minDeposit" in extra) {
    failures.push({ code: "min-deposit", label, expected: null, actual: extra.minDeposit });
  }
}

export function evaluateSds402(paymentRequired, pins = loadPins(), label = "sds-402") {
  const failures = [];
  const parsed = parsePaymentRequired(paymentRequired);
  if (!parsed.success) {
    const issues = parsed.error?.issues ?? [];
    const acceptsIssue = issues.find((issue) => issue.path?.[0] === "accepts");
    const tagsIssue = issues.find((issue) => issue.path?.[0] === "resource" && issue.path?.[1] === "tags");
    if (Array.isArray(paymentRequired?.accepts) && paymentRequired.accepts.length === 0) {
      failures.push({
        code: "accepts-empty",
        label,
        expected: ">=1",
        actual: 0,
        schema: acceptsIssue?.code ?? "too_small",
      });
    }
    if (Array.isArray(paymentRequired?.resource?.tags) && paymentRequired.resource.tags.length > (pins.sdsMcp.maxTags ?? 5)) {
      failures.push({
        code: "resource-tags-too-big",
        label,
        expected: pins.sdsMcp.maxTags ?? 5,
        actual: paymentRequired.resource.tags.length,
        schema: tagsIssue?.code ?? "too_big",
      });
    }
    if (failures.length === 0) {
      failures.push({
        code: "payment-required-invalid",
        label,
        expected: "PaymentRequired v2",
        actual: issues.map((issue) => ({ path: issue.path, code: issue.code })) ,
      });
    }
    return {
      ok: false,
      code: "sds-402-invalid",
      label,
      parseSuccess: false,
      paid: false,
      failures,
    };
  }

  const body = parsed.data;
  if (body.x402Version !== 2) {
    failures.push({ code: "x402-version-drift", label, expected: 2, actual: body.x402Version });
  }
  if (!Array.isArray(body.accepts) || body.accepts.length < 1) {
    failures.push({ code: "accepts-empty", label, expected: ">=1", actual: body.accepts?.length ?? null });
  } else {
    for (const [index, accept] of body.accepts.entries()) {
      assertExactBaseUsdcAccept(accept, pins, failures, `${label}.accepts[${index}]`);
    }
  }
  const raw = JSON.stringify(body);
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
    parseSuccess: true,
    paid: false,
    x402Version: body.x402Version,
    accepts: body.accepts,
    failures,
  };
}

export function pythonX402Present(repoRoot = REPO_ROOT) {
  const pyproject = join(repoRoot, "integrations", "agentverse-a2a", "pyproject.toml");
  if (existsSync(join(repoRoot, "requirements.txt"))) return true;
  if (!existsSync(pyproject)) return false;
  return /\bx402\s*==/.test(readFileSync(pyproject, "utf8"));
}
