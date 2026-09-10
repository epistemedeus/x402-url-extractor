/**
 * c32 S8 helpers: kit membership walk + link-index schema input from S137 fixtures.
 * Offline. Does not fetch, pay, or write outside tmp.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";

export const CELL_ROOT = dirname(fileURLToPath(import.meta.url));
export const S153_ROOT = join(CELL_ROOT, "../..");
export const KIT_ROOT = join(S153_ROOT, "kit");
export const S153_RECEIPTS = join(S153_ROOT, "receipts");
export const REPO_ROOT = join(S153_ROOT, "../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const PIN_PATH = join(CELL_ROOT, "PIN.json");

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function repoPath(...parts) {
  return join(REPO_ROOT, ...parts);
}

export function posixRel(from, to) {
  return relative(from, to).split(sep).join("/");
}

export function walkFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  function walk(abs) {
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        walk(join(abs, name));
      }
      return;
    }
    if (st.isFile()) out.push(abs);
  }
  walk(root);
  return out;
}

export function isExcludedKitMember(relPath) {
  const posix = String(relPath).split(sep).join("/");
  const parts = posix.split("/").filter(Boolean);
  const base = parts[parts.length - 1] || "";
  if (parts.some((seg) => seg.toLowerCase() === "receipts" || seg.toLowerCase() === "logs")) {
    return true;
  }
  if (/\.log$/i.test(base) || /\.jsonl$/i.test(base)) return true;
  if (/^admission-log/i.test(base) || /^cell-done/i.test(base)) return true;
  if (base === "overlap-peak.json" || base === "progress.tsv") return true;
  return false;
}

export function schemaInputFromCase(caseId) {
  const loaded = loadCase(caseId);
  const artifacts = [];
  function walk(abs, rel = "") {
    for (const name of readdirSync(abs).sort()) {
      if (name === "expected.json" || name === loaded.expected.entry) continue;
      const nextAbs = join(abs, name);
      const nextRel = rel ? `${rel}/${name}` : name;
      const st = statSync(nextAbs);
      if (st.isDirectory()) {
        walk(nextAbs, nextRel);
        continue;
      }
      const body = readFileSync(nextAbs, "utf8");
      artifacts.push({
        id: nextRel.replace(/[^A-Za-z0-9._:-]+/g, "-"),
        path: nextRel,
        exists: true,
        body,
      });
    }
  }
  walk(loaded.dir);
  return {
    schema: "s137.link-index.input.v1",
    clock: loaded.expected.clock,
    evidenceClass: loaded.expected.evidenceClass,
    caseKind: loaded.expected.kind,
    documents: [
      {
        id: "entry",
        kind: loaded.expected.format === "html" ? "html" : "markdown",
        path: loaded.expected.entry,
        body: loaded.entrySource,
      },
    ],
    artifacts,
  };
}

export function runCli(args, { cwd = REPO_ROOT, timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd,
    env: { ...process.env },
  });
}

export function parseCliJson(proc) {
  if (proc.error) throw proc.error;
  const text = proc.stdout || "";
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}
