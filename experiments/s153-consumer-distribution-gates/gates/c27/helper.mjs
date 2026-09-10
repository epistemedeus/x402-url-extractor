/**
 * c27 helpers: reuse S137 link-index conflict fixtures as schema input.
 * Does not reimplement scan/transform.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { INPUT_SCHEMA, sha256Hex } from "../../../s137-consumer-evidence-jobs/src/link-index/schema.mjs";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const FIXTURE_ROOT = join(S137_ROOT, "fixtures/synthetic/link-index");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const CLOCK = "2026-09-10T12:00:00.000Z";

export function loadPin() {
  return JSON.parse(readFileSync(join(GATE_DIR, "PIN.json"), "utf8"));
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
}

export function loadExpected(caseId) {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, "cases", caseId, "expected.json"), "utf8"));
}

export function schemaInputFromCase(caseId) {
  const expected = loadExpected(caseId);
  const dir = join(FIXTURE_ROOT, "cases", caseId);
  const entryBody = readFileSync(join(dir, expected.entry), "utf8");
  const documents = [
    {
      id: "doc-entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: entryBody,
      contentSha256: sha256Hex(entryBody),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const body = readFileSync(join(dir, cite.path), "utf8");
    artifacts.push({
      id: cite.path.replace(/[^A-Za-z0-9._:-]+/g, "-"),
      path: cite.path,
      exists: true,
      contentSha256: sha256Hex(body),
      body,
    });
  }
  return {
    expected,
    input: {
      schema: INPUT_SCHEMA,
      clock: expected.clock,
      evidenceClass: "synthetic",
      caseKind: expected.kind === "conflict" ? "conflict" : expected.kind,
      documents,
      artifacts,
    },
  };
}

export function runCliAnalyze(input, { clock = CLOCK } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "s153-c27-"));
  const inPath = join(tmp, "input.json");
  writeFileSync(inPath, `${JSON.stringify(input)}\n`);
  const proc = spawnSync(
    process.execPath,
    [CLI, "analyze", "link-index", "--in", inPath, "--clock", clock, "--compact"],
    {
      encoding: "utf8",
      timeout: 20000,
      cwd: REPO_ROOT,
      env: { ...process.env },
    },
  );
  let packet = null;
  if (proc.stdout) {
    try {
      packet = JSON.parse(proc.stdout);
    } catch {
      packet = null;
    }
  }
  return { proc, packet, inPath };
}
