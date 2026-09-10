/**
 * c26 helpers: pin check + schema input from S137 partial-mixed fixture.
 * Does not reimplement link-index transform/schema.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";
import {
  INPUT_SCHEMA,
  exampleCases,
  sha256Hex as schemaSha256Hex,
} from "../../../s137-consumer-evidence-jobs/src/link-index/schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = HERE;
export const REPO_ROOT = resolve(HERE, "../../../..");
export const PACK_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(PACK_ROOT, "scripts/cli.mjs");
export const PIN_PATH = join(HERE, "PIN.json");
export const CASE_ID = "partial-mixed";
export const CLOCK = "2026-09-10T12:00:00.000Z";

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(absPath) {
  return sha256Hex(readFileSync(absPath));
}

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function absFromRepo(relPath) {
  return join(REPO_ROOT, relPath);
}

export function verifyPinIntegrity() {
  const pin = loadPin();
  const mismatches = [];
  const rows = [...(pin.primaryFixtures || []), ...(pin.supportingFixtures || [])];
  for (const row of rows) {
    const abs = absFromRepo(row.path);
    if (!existsSync(abs)) {
      mismatches.push({ path: row.path, reason: "missing", expected: row.sha256 });
      continue;
    }
    const got = sha256File(abs);
    if (got !== row.sha256) {
      mismatches.push({ path: row.path, reason: "sha256", expected: row.sha256, got });
    }
  }
  const absentPresent = [];
  for (const row of pin.absentByDesign || []) {
    if (existsSync(absFromRepo(row.path))) absentPresent.push(row.path);
  }
  return { pin, mismatches, absentPresent };
}

export function loadPartialMixedInput() {
  const loaded = loadCase(CASE_ID);
  const documents = [
    {
      id: "doc-entry",
      kind: loaded.expected.format === "html" ? "html" : "markdown",
      path: loaded.expected.entry,
      body: loaded.entrySource,
      contentSha256: schemaSha256Hex(loaded.entrySource),
      mediaType: "text/markdown",
    },
  ];
  const artifacts = [];
  const used = new Set(["doc-entry"]);
  for (const cite of loaded.expected.citations || []) {
    if (!cite.path || cite.path === loaded.expected.entry) continue;
    const body = readFileSync(join(loaded.dir, cite.path), "utf8");
    const id = `art-${cite.path}`.replace(/[^A-Za-z0-9._:-]+/g, "-");
    used.add(id);
    artifacts.push({
      id,
      path: cite.path,
      exists: true,
      contentSha256: schemaSha256Hex(body),
      body,
    });
  }
  return {
    caseId: CASE_ID,
    dir: loaded.dir,
    expected: loaded.expected,
    input: {
      schema: INPUT_SCHEMA,
      clock: loaded.expected.clock,
      evidenceClass: "synthetic",
      caseKind: "partial",
      documents,
      artifacts,
    },
  };
}

export function schemaPartialInput() {
  return exampleCases().partial.input;
}

export function writeTempJson(value, prefix = "s153-c26-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, "input.json");
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
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
    throw new Error(`stdout was not JSON: ${error.message}\nstdout=${text}\nstderr=${proc.stderr}`);
  }
}
