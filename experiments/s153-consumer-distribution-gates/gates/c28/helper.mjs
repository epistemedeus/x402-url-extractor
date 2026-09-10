/**
 * c28 helpers: pin check + schema input from S137 negative/malformed fixtures.
 * Does not reimplement link-index scan/transform.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";
import {
  INPUT_SCHEMA,
  sha256Hex,
} from "../../../s137-consumer-evidence-jobs/src/link-index/schema.mjs";
import {
  INPUT_EXIT,
  USAGE_EXIT,
} from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const FIXTURE_ROOT = join(S137_ROOT, "fixtures/synthetic/link-index");

export { INPUT_EXIT, USAGE_EXIT };

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

export function caseById(pin, id) {
  return (pin.cases || []).find((row) => row.id === id) || null;
}

/** Build s137.link-index.input.v1 from an authored synthetic case (catalog, not a new fixture). */
export function schemaInputFromCase(caseId) {
  const loaded = loadCase(caseId);
  const expected = loaded.expected;
  const documents = [
    {
      id: "doc-entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: loaded.entrySource,
      contentSha256: sha256Hex(loaded.entrySource),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const body = readFileSync(join(loaded.dir, cite.path), "utf8");
    artifacts.push({
      id: cite.path.replace(/[^A-Za-z0-9._:-]+/g, "-"),
      path: cite.path,
      exists: true,
      contentSha256: sha256Hex(body),
      body,
    });
  }
  return {
    caseId,
    dir: loaded.dir,
    expected,
    input: {
      schema: INPUT_SCHEMA,
      clock: expected.clock,
      evidenceClass: expected.evidenceClass,
      caseKind: expected.kind,
      documents,
      artifacts,
    },
  };
}

export function writeTempJson(value, prefix = "s153-c28-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, "input.json");
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

export function runCli(args, { timeout = 20000, cwd = REPO_ROOT } = {}) {
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
      `CLI stdout was not JSON (${error.message}); status=${proc.status} stdout=${text} stderr=${proc.stderr}`,
    );
  }
}

export function analyzeLinkIndex(inPath, extra = []) {
  return runCli([
    "analyze",
    "link-index",
    "--clock",
    CLOCK,
    "--in",
    inPath,
    "--compact",
    ...extra,
  ]);
}
