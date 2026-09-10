/**
 * S153 c40 kit-membership helpers for replay-pack S8.
 * Offline path walk + sha256 + schema-input assembly. Does not pack, publish, or fetch.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  INPUT_SCHEMA,
  makeCitation,
  makeOnlinePrereq,
  requiredOnlinePrereqs,
} from "../../../s137-consumer-evidence-jobs/src/replay-pack/schema.mjs";
import {
  loadCase,
  loadClock,
  loadOpenApi,
  namedResponseExample,
  readJson,
} from "../../../s137-consumer-evidence-jobs/fixtures/synthetic/replay-pack/load.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const GATE_DIR = HERE;
export const REPO_ROOT = join(HERE, "..", "..", "..", "..");
export const PACK_ROOT = join(REPO_ROOT, "experiments", "s137-consumer-evidence-jobs");
export const KIT_ROOT = join(REPO_ROOT, "experiments", "s153-consumer-distribution-gates", "kit");
export const CLI = join(PACK_ROOT, "scripts", "cli.mjs");
export const SYNTHETIC_REPLAY = join(PACK_ROOT, "fixtures", "synthetic", "replay-pack");
export const REAL_REPLAY = join(PACK_ROOT, "fixtures", "real", "replay-pack");
export const CLOCK = "2026-09-10T12:00:00.000Z";
export const CASE_ID = "positive-unpaid-complete";
export const LAB = "https://api.example.test";

export function posixRel(from, to) {
  return relative(from, to).split(sep).join("/");
}

export function sha256File(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export function loadPin() {
  return JSON.parse(readFileSync(join(HERE, "PIN.json"), "utf8"));
}

export function absFromRepo(rel) {
  return join(REPO_ROOT, rel);
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

  if (parts.includes("logs") || parts[0] === "logs" || /\.log$/i.test(base)) {
    return { class: "logs", distributable: false };
  }
  if (/\.jsonl$/i.test(base) && (parts.includes("concurrency") || parts.includes("logs"))) {
    return { class: "logs", distributable: false };
  }
  if (parts.includes("receipts") || parts[0] === "receipts") {
    return { class: "receipts", distributable: false };
  }

  if (base === "MANIFEST.json" || /\/MANIFEST\.json$/i.test(n)) {
    return { class: "manifests", distributable: true };
  }
  if (/^readme(\.md|\.txt)?$/i.test(base)) {
    return { class: "README", distributable: true };
  }
  if (
    n.includes("fixtures/synthetic/replay-pack/cases/")
    || n.includes("fixtures/synthetic/replay-pack/examples/")
    || n.includes("/examples/")
    || n.startsWith("cases/")
    || n.startsWith("examples/")
    || (n.includes("fixtures/real/replay-pack/") && !/^provenance(\.test)?\.mjs$/i.test(base))
  ) {
    return { class: "examples", distributable: true };
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

export function hashedCitations(doc) {
  return (doc.citations || [])
    .filter((row) => typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256))
    .map((row) =>
      makeCitation({
        id: row.id,
        path: row.path || null,
        url: row.url || null,
        sha256: row.sha256,
        licenseNote: row.note || "synthetic fixture; not an official provider capture",
        evidenceClass: row.evidenceClass || "synthetic",
      }),
    );
}

export function schemaInputFromPositive() {
  const caseId = CASE_ID;
  const doc = loadCase(caseId);
  const openapi = loadOpenApi(caseId);
  const companion = readJson(`cases/${caseId}/examples/getStatus.response.json`);
  const enabled = namedResponseExample(openapi, "getStatus", "enabled");
  const citations = hashedCitations(doc);
  const citeIds = citations.map((row) => row.id).slice(0, 2);
  return {
    schema: INPUT_SCHEMA,
    clock: loadClock(),
    evidenceClass: "synthetic",
    citations,
    examples: [
      {
        id: "getStatus-enabled",
        kind: "http-exchange",
        citationIds: citeIds,
        request: { method: "GET", url: `${LAB}/v0/status` },
        response: {
          status: companion.httpStatus ?? companion.status,
          body: companion.body,
        },
        openapi: { value: enabled?.value ?? enabled },
        coverage: "full",
        replayMode: "offline-fixture",
        execution: {
          status: "not-executed",
          providerExecuted: false,
          providerInvoked: false,
          fakedProviderExecution: false,
          synthesizedResponse: false,
          liveProviderCall: false,
          assignmentSpendUsd: 0,
        },
      },
    ],
    online: {
      requested: false,
      consent: false,
      prereqs: requiredOnlinePrereqs().map((row) =>
        makeOnlinePrereq({ ...row, satisfied: false }),
      ),
      allowlistedUrls: [],
    },
  };
}

export function writeTempSchemaInput(input) {
  const dir = mkdtempSync(join(tmpdir(), "s153-c40-"));
  const path = join(dir, "replay-pack-input.json");
  writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`);
  return { dir, path };
}

export function runCli(args, { timeout = 20000 } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    timeout,
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
}

export function parseStdoutJson(proc) {
  if (proc.error) throw proc.error;
  const text = String(proc.stdout || "").trim();
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error(
      `CLI stdout is not JSON (status ${proc.status}): ${text.slice(0, 200)}\nstderr=${proc.stderr}`,
    );
  }
  try {
    return JSON.parse(text.slice(start));
  } catch (error) {
    throw new Error(
      `CLI stdout was not JSON: ${error.message}\nstatus=${proc.status}\nstdout=${text}\nstderr=${proc.stderr}`,
    );
  }
}
