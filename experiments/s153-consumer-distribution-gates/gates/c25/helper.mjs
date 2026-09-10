/**
 * c25 helpers: pin + synthetic positive-md/html → s137.link-index.input.v1.
 * Does not reimplement transform. Offline only.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCase } from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/link-index/catalog.mjs";
import { INPUT_SCHEMA } from "../../../s137-consumer-evidence-jobs/src/link-index/schema.mjs";

const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(GATE_DIR, "../../../..");
export const S137_ROOT = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs");
export const CLI = join(S137_ROOT, "scripts/cli.mjs");
export const PIN_PATH = join(GATE_DIR, "PIN.json");
const ID_SAFE = /[^A-Za-z0-9._:-]+/g;

export function loadPin() {
  return JSON.parse(readFileSync(PIN_PATH, "utf8"));
}

export function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256File(absPath) {
  return sha256Bytes(readFileSync(absPath));
}

export function repoFile(relPath) {
  return join(REPO_ROOT, relPath);
}

function makeId(prefix, hint, used) {
  let core = String(hint || "x")
    .replace(ID_SAFE, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!/^[A-Za-z]/.test(core)) core = `x${core}`;
  if (!core) core = "x";
  let id = `${prefix}-${core}`.slice(0, 128);
  let n = 2;
  while (used.has(id)) {
    const suffix = `-${n}`;
    id = `${prefix}-${core}`.slice(0, 128 - suffix.length) + suffix;
    n += 1;
  }
  used.add(id);
  return id;
}

/** Build schema input from an authored synthetic case (catalog, not a new fixture). */
export function schemaInputFromCase(caseId) {
  const loaded = loadCase(caseId);
  const expected = loaded.expected;
  const used = new Set(["entry"]);
  const documents = [
    {
      id: "entry",
      kind: expected.format === "html" ? "html" : "markdown",
      path: expected.entry,
      body: loaded.entrySource,
      contentSha256: sha256Bytes(loaded.entryBytes),
      mediaType: expected.format === "html" ? "text/html" : "text/markdown",
    },
  ];
  const artifacts = [];
  for (const cite of expected.citations || []) {
    if (!cite.path || cite.path === expected.entry) continue;
    const abs = join(loaded.dir, cite.path);
    const buf = readFileSync(abs);
    const hash = sha256Bytes(buf);
    if (cite.sha256 && cite.sha256 !== hash) {
      throw new Error(`observed hash ${hash} != claimed ${cite.sha256} for ${cite.path}`);
    }
    artifacts.push({
      id: makeId("art", cite.path, used),
      path: cite.path,
      exists: true,
      contentSha256: hash,
      body: buf.toString("utf8"),
    });
  }
  return {
    schema: INPUT_SCHEMA,
    clock: expected.clock,
    evidenceClass: expected.evidenceClass,
    caseKind: "positive",
    documents,
    artifacts,
    expected,
  };
}

export function runCli(args, { timeout = 20000, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  });
}

export function parseStdoutJson(proc) {
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

export function writeTempInput(input) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c25-"));
  const path = join(dir, "input.json");
  const { expected, ...schemaInput } = input;
  void expected;
  writeFileSync(path, `${JSON.stringify(schemaInput, null, 2)}\n`);
  return { dir, path };
}
