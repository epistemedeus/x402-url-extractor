/**
 * c29 helpers: pin-checked fixture → schema input, spawn S137 CLI, parse stdout JSON.
 * Does not fetch, pay, or rewrite S137 modules.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACTS,
  EXCLUDED_JOBS,
  INPUT_EXIT,
  PACKET_SCHEMA,
  USAGE_EXIT,
} from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";
import {
  ARTIFACT_KIND,
  INPUT_SCHEMA,
  JOB_ID,
  sha256Hex,
  validateInput,
} from "../../../s137-consumer-evidence-jobs/src/link-index/schema.mjs";
import {
  caseDir,
  loadExpected,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
export const CLI = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const FAMILY_SCHEMA = "s137.consumer-evidence.family.v1";

export { ARTIFACTS, ARTIFACT_KIND, EXCLUDED_JOBS, INPUT_EXIT, INPUT_SCHEMA, JOB_ID, PACKET_SCHEMA, USAGE_EXIT, validateInput };

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

function makeArtId(pathValue, used) {
  let core = String(pathValue || "art")
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!/^[A-Za-z]/.test(core)) core = `x${core}`;
  if (!core) core = "x";
  let id = `art-${core}`.slice(0, 128);
  let n = 2;
  while (used.has(id)) {
    const suffix = `-${n}`;
    id = `art-${core}`.slice(0, 128 - suffix.length) + suffix;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Build s137.link-index.input.v1 from a synthetic case directory.
 * Bodies and hashes come from the authored files; expected.json is the pin, not the input.
 */
export function loadSyntheticCaseInput(caseId) {
  const expected = loadExpected(caseId);
  const dir = caseDir(caseId);
  const entryBody = readFileSync(join(dir, expected.entry));
  const used = new Set(["doc-entry"]);
  const documents = [
    {
      id: "doc-entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: entryBody.toString("utf8"),
      contentSha256: sha256Hex(entryBody),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const bytes = readFileSync(join(dir, cite.path));
    artifacts.push({
      id: makeArtId(cite.path, used),
      path: cite.path,
      exists: true,
      contentSha256: sha256Hex(bytes),
      body: bytes.toString("utf8"),
    });
  }
  const input = {
    schema: INPUT_SCHEMA,
    clock: expected.clock,
    evidenceClass: "synthetic",
    caseKind: expected.kind === "conflict" ? "conflict" : expected.kind,
    documents,
    artifacts,
  };
  return { caseId, expected, input, dir };
}

export function loadRealReadmeInput(pin = loadPin()) {
  const rel = pin.realFixture.path;
  const body = readFileSync(repoFile(rel));
  const input = {
    schema: INPUT_SCHEMA,
    clock: pin.realFixture.clock,
    evidenceClass: "fixture",
    documents: [
      {
        id: "doc-readme",
        kind: "markdown",
        path: "x402-foundation-x402-README.md",
        url: "https://raw.githubusercontent.com/x402-foundation/x402/3c2ddfb922893c91ef8f281b64f8045d1f5e0d75/README.md",
        body: body.toString("utf8"),
        contentSha256: sha256Hex(body),
        mediaType: "text/markdown",
      },
    ],
  };
  return { input, rel, sha256: sha256Hex(body) };
}

export function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c29-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeInput(dir, name, input) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(input));
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
      `stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}

export function analyzeLinkIndex(inPath, { clock = CLOCK, extra = [], compact = true } = {}) {
  const args = [
    "analyze",
    "link-index",
    "--clock",
    clock,
    "--in",
    inPath,
    ...(compact ? ["--compact"] : []),
    ...extra,
  ];
  const proc = runCli(args);
  return { proc, packet: parseCliJson(proc) };
}

export function analyzeAll(inPath, { clock = CLOCK, extra = [] } = {}) {
  const proc = runCli([
    "analyze",
    "--all",
    "--clock",
    clock,
    "--in",
    inPath,
    "--compact",
    ...extra,
  ]);
  return { proc, family: parseCliJson(proc) };
}
