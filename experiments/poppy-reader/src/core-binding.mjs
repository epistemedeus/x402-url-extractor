// Load H64220 only from its declared Git export. Absence is not compatibility.
// A guessed module name is never imported.

import { execFileSync } from "node:child_process";
import { realpath, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const H64220 = Object.freeze({
  repository: "https://github.com/epistemedeus/pilot.git",
  branch: "codex/root64220-heavy-window-20261029",
  scope: "experiments/oct29-poppy/core",
  manifest: "experiments/oct29-poppy/core/EXPORT.json",
  schema: "h64220.poppy-core.export.v1",
});

function publicView(view) {
  return {
    repository: view.repository,
    branch: view.branch,
    scope: H64220.scope,
    head: view.head,
    manifest: H64220.manifest,
    manifestPresent: view.manifestPresent === true,
    integrated: false,
    invoked: false,
    exportName: view.exportName ?? null,
    reason: view.reason,
    evidence: view.evidence ?? "checkout",
  };
}

export function finishAssessment(assessment, { invoked = false, invokeError = null } = {}) {
  const loaded = typeof assessment.verify === "function" && assessment.reason === "loaded-function";
  const { verify: _ignored, ...rest } = assessment;
  return {
    ...rest,
    integrated: loaded && invoked === true && invokeError == null,
    invoked: invoked === true && invokeError == null,
    invokeError,
  };
}

export async function assessCheckout(dir, head) {
  const base = {
    repository: H64220.repository,
    branch: H64220.branch,
    head,
    manifestPresent: false,
    exportName: null,
    reason: "manifest-absent",
    verify: null,
  };
  const manifestPath = path.join(dir, H64220.manifest);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    base.manifestPresent = true;
  } catch (error) {
    if (error?.code === "ENOENT") return { ...publicView(base), verify: null };
    return { ...publicView({ ...base, reason: "manifest-unreadable" }), verify: null };
  }
  if (!manifest || manifest.schema !== H64220.schema || typeof manifest.module !== "string" || typeof manifest.export !== "string") {
    return { ...publicView({ ...base, reason: "manifest-rejected" }), verify: null };
  }
  if (manifest.module.startsWith("/") || manifest.module.includes("\0")) {
    return { ...publicView({ ...base, exportName: manifest.export, reason: "module-escapes-scope" }), verify: null };
  }
  const scopeDir = path.join(dir, H64220.scope);
  const modulePath = path.resolve(scopeDir, manifest.module);
  let realModule;
  let realScope;
  try {
    realScope = await realpath(scopeDir);
    realModule = await realpath(modulePath);
  } catch {
    return { ...publicView({ ...base, exportName: manifest.export, reason: "module-unreadable" }), verify: null };
  }
  if (realModule !== realScope && !realModule.startsWith(realScope + path.sep)) {
    return { ...publicView({ ...base, exportName: manifest.export, reason: "module-escapes-scope" }), verify: null };
  }
  try {
    const loaded = await import(pathToFileURL(realModule).href);
    const fn = loaded[manifest.export];
    if (typeof fn !== "function") {
      return { ...publicView({ ...base, exportName: manifest.export, reason: "export-not-function" }), verify: null };
    }
    return {
      ...publicView({ ...base, exportName: manifest.export, reason: "loaded-function" }),
      verify: fn,
    };
  } catch {
    return { ...publicView({ ...base, exportName: manifest.export, reason: "import-failed" }), verify: null };
  }
}

export function remoteHead(repository = H64220.repository, branch = H64220.branch) {
  const output = execFileSync("git", ["ls-remote", repository, `refs/heads/${branch}`], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const sha = output.trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha || "")) throw new Error("H64220 ls-remote did not return a commit");
  return sha;
}

export async function fetchH64220Head(dest) {
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  const git = (args) => execFileSync("git", args, {
    cwd: dest,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  execFileSync("git", [
    "clone", "--depth", "1", "--filter=blob:none", "--sparse",
    "--branch", H64220.branch, H64220.repository, dest,
  ], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  git(["sparse-checkout", "set", "experiments/oct29-poppy"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const assessed = await assessCheckout(dest, head);
  return { ...assessed, evidence: "fetched-source" };
}
