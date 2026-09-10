/**
 * S153 c16 kit-membership helpers for release-brief S8.
 * Offline path walk + sha256 only. Does not pack, publish, or fetch.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const PACK_ROOT = join(REPO_ROOT, "experiments", "s137-consumer-evidence-jobs");
export const KIT_ROOT = join(REPO_ROOT, "experiments", "s153-consumer-distribution-gates", "kit");
export const CLI = join(PACK_ROOT, "scripts", "cli.mjs");
export const SYNTHETIC_RELEASE = join(PACK_ROOT, "fixtures", "synthetic", "release-brief");
export const CLOCK = "2026-09-10T12:00:00.000Z";

export function posixRel(from, to) {
  return relative(from, to).split(sep).join("/");
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function walkFiles(absRoot) {
  const out = [];
  if (!existsSync(absRoot)) return out;
  const st = statSync(absRoot);
  if (st.isFile()) {
    out.push(absRoot);
    return out;
  }
  const stack = [absRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      if (name === "." || name === "..") continue;
      const next = join(dir, name);
      const nextSt = statSync(next);
      if (nextSt.isDirectory()) stack.push(next);
      else if (nextSt.isFile()) out.push(next);
    }
  }
  return out.sort();
}

/**
 * Classify a pack- or kit-relative posix path.
 * Include classes: manifests | README | examples
 * Exclude classes: receipts | logs
 */
export function classifyRel(rel) {
  const n = String(rel || "").split(sep).join("/").replace(/^\.\//, "");
  const parts = n.split("/").filter(Boolean);
  const base = parts[parts.length - 1] || "";
  const lower = n.toLowerCase();

  if (parts.includes("receipts") || parts[0] === "receipts") {
    return { class: "receipts", distributable: false };
  }
  if (parts.includes("logs") || parts[0] === "logs" || /\.log$/i.test(base)) {
    return { class: "logs", distributable: false };
  }
  if (/\.jsonl$/i.test(base) && parts.includes("concurrency")) {
    return { class: "logs", distributable: false };
  }

  if (base === "MANIFEST.json" || /\/MANIFEST\.json$/i.test(n)) {
    return { class: "manifests", distributable: true };
  }
  if (/^readme(\.md|\.txt)?$/i.test(base)) {
    return { class: "README", distributable: true };
  }
  if (
    n.includes("fixtures/synthetic/release-brief/cases/")
    || n.includes("fixtures/synthetic/release-brief/sources/")
    || n.includes("fixtures/real/release-brief/")
    || n.startsWith("cases/")
    || n.startsWith("sources/")
    || n.startsWith("examples/")
  ) {
    return { class: "examples", distributable: true };
  }

  if (lower.includes("/receipts/") || lower.startsWith("receipts/")) {
    return { class: "receipts", distributable: false };
  }
  return { class: "other", distributable: true };
}

export function isExcludedRel(rel) {
  return classifyRel(rel).distributable === false;
}

export function requiredSourceMembers(pin) {
  return (pin.membership?.sourceRequiredRel || []).map((rel) => ({
    rel,
    abs: join(PACK_ROOT, rel),
  }));
}

export function excludedSourceMembers(pin) {
  return (pin.membership?.sourceExcludedRel || []).map((rel) => ({
    rel,
    abs: join(PACK_ROOT, rel),
  }));
}

export function kitMembers() {
  return walkFiles(KIT_ROOT).map((abs) => {
    const rel = posixRel(KIT_ROOT, abs);
    return { abs, rel, ...classifyRel(rel) };
  });
}

export function loadPin() {
  return JSON.parse(readFileSync(join(HERE, "PIN.json"), "utf8"));
}
