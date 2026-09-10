import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(GATE_DIR, "../../../..");
export const CLI = join(REPO_ROOT, "experiments/s137-consumer-evidence-jobs/scripts/cli.mjs");
export const KIT_DIR = join(REPO_ROOT, "experiments/s153-consumer-distribution-gates/kit");
export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const SHA1_HEX = /^[0-9a-f]{40}$/i;

export function loadPin() {
  return JSON.parse(readFileSync(join(GATE_DIR, "PIN.json"), "utf8"));
}

export function abs(relPath) {
  return join(REPO_ROOT, relPath);
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readJson(relOrAbs) {
  const path = relOrAbs.startsWith("/") ? relOrAbs : abs(relOrAbs);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function asBrief(result) {
  if (!result || typeof result !== "object") return result;
  if (result.brief && typeof result.brief === "object") return result.brief;
  if (result.packet && typeof result.packet === "object") return result.packet;
  return result;
}

export function walkRelFiles(dir, acc = [], prefix = "") {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    const next = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = statSync(next);
    if (st.isDirectory()) walkRelFiles(next, acc, rel);
    else acc.push(rel);
  }
  return acc;
}

export function citationLocator(row) {
  return [row?.path, row?.url, row?.id].filter(Boolean).join(" ");
}

export function runCli(args, { timeout = 15000, cwd = REPO_ROOT } = {}) {
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
    throw new Error(`CLI stdout was not JSON: ${error.message}\nstdout=${text}\nstderr=${proc.stderr}`);
  }
}

export function realExpressInput(pin) {
  const provenance = readJson(pin.realFixtureDir + "/PROVENANCE.json");
  const snapshotPath = abs(pin.realFixtureDir + "/github-express-v5.2.1.json");
  const bytes = readFileSync(snapshotPath);
  const snapshot = JSON.parse(bytes.toString("utf8"));
  const tag = typeof snapshot.tag_name === "string" ? snapshot.tag_name : "v5.2.1";
  return {
    schema: "s137.release-brief.input.v1",
    clock: provenance.clock,
    evidenceClass: "fixture",
    jobId: pin.jobId,
    subject: { name: "express", tag },
    sources: [{
      id: "github-release-express-v5.2.1",
      kind: "github-release",
      path: "experiments/s137-consumer-evidence-jobs/fixtures/real/release-brief/github-express-v5.2.1.json",
      url: provenance.url,
      contentSha256: sha256File(snapshotPath),
      retrievedAt: provenance.retrievedAt,
      licenseNote: provenance.license.note,
      payload: snapshot,
      // Announced split only. Do not supply split.shipped: tarball_url / branch
      // target_commitish are not observed ships.
      split: {
        announced: {
          identity: {
            role: "claimed",
            tag,
            version: tag.startsWith("v") ? tag.slice(1) : tag,
          },
          payload: {
            title: snapshot.name,
            body: snapshot.body,
            publishedAt: snapshot.published_at,
            draft: snapshot.draft,
            prerelease: snapshot.prerelease,
            htmlUrl: snapshot.html_url,
            targetCommitish: snapshot.target_commitish,
          },
        },
      },
    }],
  };
}
