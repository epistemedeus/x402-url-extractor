import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { buildReport } from "./classify.mjs";
import { loadCorpus, loadPin, loadProfile } from "./corpus.mjs";

const require = createRequire(import.meta.url);
const RESULT_DIR = /^server-(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)$/;

/**
 * Locate the installed official runner and refuse any version other than the
 * pin. Install happens on the Cursor VM only (npm ci in this package).
 */
export function resolveRunner({ pin = loadPin(), resolve = (id) => require.resolve(id) } = {}) {
  const pkgPath = resolve(`${pin.officialRunner.package}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== pin.officialRunner.package || pkg.version !== pin.officialRunner.version) {
    const error = new Error(`official runner ${pkg.name}@${pkg.version} does not match pin ${pin.officialRunner.package}@${pin.officialRunner.version}`);
    error.code = "runner_version_mismatch";
    throw error;
  }
  const root = dirname(pkgPath);
  return {
    name: pkg.name,
    version: pkg.version,
    root,
    entry: join(root, pin.officialRunner.entry),
    requirementsDir: join(root, "requirements"),
  };
}

/**
 * Read the server leg of a requirement set. Handles the flat YAML layout the
 * pinned runner ships (top-level `server:` list and `not_scored:` entries with
 * `scenario:` and `leg:` keys). It is not a general YAML parser.
 */
export function parseRequirementSet(text, leg = "server") {
  const scored = [];
  const notScored = [];
  let section = null;
  let pending = null;
  const flush = () => {
    if (pending && pending.leg === leg && pending.scenario) notScored.push(pending);
    pending = null;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (/^\s*#/.test(raw) || line.trim() === "") continue;
    const top = /^([A-Za-z_]+):\s*$/.exec(line);
    if (top) { flush(); section = top[1]; continue; }
    if (section === leg) {
      const item = /^\s+-\s+(\S+)\s*$/.exec(line);
      if (item) scored.push(item[1]);
      continue;
    }
    if (section === "not_scored") {
      const start = /^\s+-\s+scenario:\s*(\S+)\s*$/.exec(line);
      if (start) { flush(); pending = { scenario: start[1] }; continue; }
      const field = /^\s+(leg|reason):\s*(\S+)\s*$/.exec(line);
      if (field && pending) pending[field[1]] = field[2];
    }
  }
  flush();
  return { scored, notScored };
}

/** Collect per-scenario checks.json files written by `conformance server -o <dir>`. */
export function readLegResults(dir) {
  if (!existsSync(dir)) return [];
  const scenarios = [];
  for (const name of readdirSync(dir).sort()) {
    const match = RESULT_DIR.exec(name);
    if (!match) continue;
    const file = join(dir, name, "checks.json");
    if (!existsSync(file)) {
      scenarios.push({ scenario: match[1], checks: null, parseError: "checks.json missing", resultDir: name });
      continue;
    }
    try {
      scenarios.push({ scenario: match[1], checks: JSON.parse(readFileSync(file, "utf8")), resultDir: name });
    } catch (error) {
      scenarios.push({ scenario: match[1], checks: null, parseError: error.message, resultDir: name });
    }
  }
  return scenarios;
}

export function runnerArgs({ entry, url, revision, outDir, scenarioTimeoutMs }) {
  return [entry, "server", "--url", url, "--requirements", revision, "--output-dir", outDir, "--timeout", String(scenarioTimeoutMs)];
}

export function runLeg({
  runner,
  url,
  revision,
  outDir,
  scenarioTimeoutMs = 10000,
  legTimeoutMs = 600000,
  spawn = nodeSpawn,
  execPath = process.execPath,
}) {
  mkdirSync(outDir, { recursive: true });
  let expectedScenarios = [];
  let scoredScenarios = [];
  const requirementFile = join(runner.requirementsDir, `${revision}.yaml`);
  if (existsSync(requirementFile)) {
    const set = parseRequirementSet(readFileSync(requirementFile, "utf8"), "server");
    scoredScenarios = set.scored;
    expectedScenarios = [...set.scored, ...set.notScored.map((item) => item.scenario)];
  }
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(execPath, runnerArgs({ entry: runner.entry, url, revision, outDir, scenarioTimeoutMs }), {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      });
    } catch (error) {
      resolvePromise({ revision, spawnError: error.message, scenarios: [], expectedScenarios, stdout, stderr });
      return;
    }
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, legTimeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ revision, spawnError: error.message, scenarios: [], expectedScenarios, stdout, stderr });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolvePromise({
        revision,
        exitCode,
        signal: timedOut ? null : signal,
        timedOut,
        expectedScenarios,
        scoredScenarios,
        scenarios: readLegResults(outDir),
        stdoutTail: stdout.slice(-4000),
        stderrTail: stderr.slice(-4000),
      });
    });
  });
}

/**
 * Run the pinned official runner against an MCP endpoint, once per requirement
 * set at its own wire version, and classify every check against the recorded
 * free page-change profile. The runner's own exit code is recorded but is not
 * the verdict: refused 2026-07-28 scenarios fail by design here.
 */
export async function runOfficialConformance({
  url,
  revisions = ["2025-11-25", "2026-07-28"],
  outRoot,
  scenarioTimeoutMs,
  legTimeoutMs,
  runner,
  spawn,
  now = () => new Date(),
  profile = loadProfile(),
  cases = loadCorpus(),
  pin = loadPin(),
} = {}) {
  if (!url) throw new Error("url is required");
  if (!outRoot) throw new Error("outRoot is required");
  let resolved = runner;
  if (!resolved) {
    try {
      resolved = resolveRunner({ pin });
    } catch (error) {
      const legs = revisions.map((revision) => ({ revision, spawnError: error.message, scenarios: [] }));
      return buildReport(legs, { profile, cases, pin, target: { url }, observedAt: now().toISOString() });
    }
  }
  const legs = [];
  for (const revision of revisions) {
    legs.push(await runLeg({
      runner: resolved,
      url,
      revision,
      outDir: join(outRoot, revision),
      scenarioTimeoutMs,
      legTimeoutMs,
      spawn,
    }));
  }
  const report = buildReport(legs, { profile, cases, pin, target: { url }, observedAt: now().toISOString() });
  report.runner.installedVersion = resolved.version;
  report.legs = legs.map((leg) => ({
    revision: leg.revision,
    exitCode: leg.exitCode ?? null,
    timedOut: Boolean(leg.timedOut),
    expectedScenarios: leg.expectedScenarios?.length ?? 0,
    parsedScenarios: leg.scenarios?.length ?? 0,
    stderrTail: leg.stderrTail || "",
  }));
  return report;
}
