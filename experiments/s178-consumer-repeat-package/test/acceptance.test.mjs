#!/usr/bin/env node
/**
 * S182 acceptance: exact per-case outcomes, useful artifacts, S174 regressions.
 * A required positive that is fail/invalid/unsupported FAILS this suite.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, findJob } from "../src/catalog.mjs";
import { examplePath, runJob } from "../src/run-job.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const CLOCK = "2026-09-10T18:00:00.000Z";
const CLI = join(PKG, "bin/s178-cli.mjs");
const failures = [];

function check(name, cond, detail) {
  if (!cond) failures.push({ name, detail });
  console.log(cond ? `PASS ${name}` : `FAIL ${name} :: ${detail}`);
}

const EXPECTED = Object.freeze({
  "01": { positive: "pass", partial: "partial", negative: "fail", conflict: "conflict" },
  "02": { positive: "pass", partial: "partial", negative: "fail", conflict: "conflict" },
  "03": { positive: "pass", partial: "partial", negative: "fail", conflict: "conflict" },
  "04": { positive: "pass", partial: "partial", negative: "fail", conflict: "conflict" },
  "05": { positive: "pass", partial: "partial", negative: "fail", conflict: "conflict" },
  "06": { positive: "pass", partial: "partial", negative: "unknown", conflict: "conflict" },
  "07": { positive: "pass", partial: "partial", negative: "fail" },
  "08": { positive: "pass", partial: "partial", negative: "fail" },
  acquire: { positive: "partial", partial: "partial", negative: "fail" },
});

function usefulPositive(token, result) {
  if (result.decision !== "pass" && !(token === "acquire" && result.decision === "partial")) {
    return `decision ${result.decision}`;
  }
  const a = result.artifact || {};
  if (token === "01") {
    const n = Array.isArray(a.checklist) ? a.checklist.length : 0;
    return n > 0 && Array.isArray(result.findings) && result.findings.length > 0
      ? true
      : `checklist=${n} findings=${result.findings?.length}`;
  }
  if (token === "02") {
    const ann = a.announced?.items?.length ?? a.announced?.length ?? 0;
    return ann > 0 || a.alignment ? true : "missing announced/alignment";
  }
  if (token === "03") {
    const n = Array.isArray(a.groups) ? a.groups.length : 0;
    return n > 0 && a.inventTotals !== true ? true : `groups=${n} inventTotals=${a.inventTotals}`;
  }
  if (token === "04") {
    const n = Array.isArray(a.links) ? a.links.length : 0;
    return n > 0 && a.coverage?.networkFetched !== true ? true : `links=${n}`;
  }
  if (token === "05") {
    const n = Array.isArray(a.examples) ? a.examples.length : 0;
    const faked = a.examples?.some((e) => e.execution?.fakedProviderExecution === true);
    return n > 0 && !faked ? true : `examples=${n} faked=${faked}`;
  }
  if (token === "06") {
    const n = Array.isArray(a.datasets) ? a.datasets.length : 0;
    return n > 0 ? true : "no datasets";
  }
  if (token === "07") {
    const n = Array.isArray(a.comparisons) ? a.comparisons.length : 0;
    return n > 0 || a.status ? true : "no comparisons";
  }
  if (token === "08") {
    const n = Array.isArray(a.recipes) ? a.recipes.length : 0;
    return n > 0 ? true : "no recipes";
  }
  if (token === "acquire") {
    const n = Array.isArray(a.recipes) ? a.recipes.length : 0;
    return n > 0 && a.packageStatus === "partial" && a.acquisitionOk === true
      ? true
      : `recipes=${n} status=${a.packageStatus} ok=${a.acquisitionOk}`;
  }
  return true;
}

function spawnCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: PKG,
    timeout: 20000,
  });
}

function parseCli(proc) {
  if (proc.status !== 0 && proc.status !== 1) {
    return { parseError: true, status: proc.status, stderr: proc.stderr, stdout: proc.stdout };
  }
  try {
    return JSON.parse(proc.stdout);
  } catch (err) {
    return { parseError: true, message: err.message, stdout: proc.stdout, stderr: proc.stderr };
  }
}

const catalog = buildCatalog();
check("catalog_job_count", catalog.jobs.length >= 9, `got ${catalog.jobs.length}`);

{
  const job = findJob("release-brief");
  const input = examplePath(job, "conflict");
  for (const mode of ["cli", "import"]) {
    const r = await runJob({ jobToken: "release-brief", inputPath: input, clock: CLOCK, mode });
    check(
      `s174_release_brief_conflict_${mode}`,
      r.ok && r.decision === "conflict",
      JSON.stringify({ decision: r.decision, ok: r.ok, error: r.error }),
    );
  }
  const partial = examplePath(job, "partial");
  const p = await runJob({ jobToken: "release-brief", inputPath: partial, clock: CLOCK, mode: "cli" });
  check(
    "s174_release_brief_partial",
    p.ok && p.decision === "partial",
    JSON.stringify({ decision: p.decision }),
  );

  const dir = mkdtempSync(join(tmpdir(), "s182-wrapper-"));
  const bad = join(dir, "malformed-wrapper.json");
  writeFileSync(
    bad,
    JSON.stringify({
      schema: "s137.release-brief.synthetic-case.v1",
      id: "malformed-wrapper",
      clock: CLOCK,
      evidenceClass: "synthetic",
      lanes: { announced: "missing.json" },
    }),
  );
  try {
    const w = await runJob({
      jobToken: "release-brief",
      inputPath: bad,
      clock: CLOCK,
      mode: "import",
    });
    check(
      "s174_malformed_wrapper_not_pass",
      w.decision !== "pass",
      JSON.stringify({ decision: w.decision, ok: w.ok }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const token of Object.keys(EXPECTED)) {
  const job = findJob(token);
  check(`discover_${token}`, Boolean(job), "missing from catalog");
  if (!job) continue;
  const expect = EXPECTED[token];

  for (const kind of Object.keys(expect)) {
    const input = examplePath(job, kind);
    check(`example_${kind}_${token}`, Boolean(input) && existsSync(input), String(input));
    if (!input) continue;
    const r = await runJob({ jobToken: token, inputPath: input, clock: CLOCK, mode: "import" });
    check(
      `import_${kind}_${token}`,
      r.ok === true && r.decision === expect[kind],
      JSON.stringify({
        expected: expect[kind],
        decision: r.decision,
        ok: r.ok,
        error: r.error,
      }),
    );
    if (kind === "positive") {
      const useful = usefulPositive(token, r);
      check(`import_artifact_${token}`, useful === true, useful === true ? "" : String(useful));
      check(
        `import_sources_${token}`,
        Array.isArray(r.sources) && r.sources.length > 0,
        JSON.stringify(r.sources),
      );
    }
    if (kind !== "positive" || expect[kind] !== "pass") {
      check(
        `repeat_input_${kind}_${token}`,
        Boolean(r.repeatInput) &&
          Array.isArray(r.repeatInput.nextActions) &&
          r.repeatInput.nextActions.length > 0,
        JSON.stringify(r.repeatInput),
      );
    }
  }

  const pos = await runJob({
    jobToken: token,
    inputPath: examplePath(job, "positive"),
    clock: CLOCK,
    mode: "cli",
  });
  check(
    `cli_positive_${token}`,
    pos.ok === true && pos.decision === expect.positive,
    JSON.stringify({ expected: expect.positive, decision: pos.decision, ok: pos.ok, error: pos.error }),
  );
  const usefulCli = usefulPositive(token, pos);
  check(`cli_artifact_${token}`, usefulCli === true, usefulCli === true ? "" : String(usefulCli));

  const spawned = parseCli(
    spawnCli(["run", token, "--clock", CLOCK, "--mode", "cli"]),
  );
  check(
    `spawn_cli_positive_${token}`,
    !spawned.parseError && spawned.decision === expect.positive,
    JSON.stringify({
      expected: expect.positive,
      decision: spawned.decision,
      parseError: spawned.parseError,
      error: spawned.error,
    }),
  );

  const otherKind = expect.partial && expect.partial !== expect.positive ? "partial" : "negative";
  const other = await runJob({
    jobToken: token,
    inputPath: examplePath(job, otherKind),
    clock: CLOCK,
    mode: "import",
  });
  const posIds = (pos.findings || []).map((f) => f.id).join(",");
  const otherIds = (other.findings || []).map((f) => f.id).join(",");
  check(
    `changed_input_${token}`,
    pos.decision !== other.decision || posIds !== otherIds,
    JSON.stringify({ pos: pos.decision, other: other.decision, posIds, otherIds }),
  );
}

{
  const job = findJob("04");
  const dir = mkdtempSync(join(tmpdir(), "s182-emptydir-"));
  try {
    const r = await runJob({
      jobToken: "link-index",
      inputPath: dir,
      clock: CLOCK,
      mode: "import",
    });
    check(
      "import_dir_guidance_04",
      r.decision === "invalid" &&
        r.decision !== "pass" &&
        Boolean(r.repeatInput?.nextActions?.length) &&
        (r.error?.code === "unsupported_input" || r.error?.code === "invalid_input"),
      JSON.stringify({ decision: r.decision, error: r.error, repeat: r.repeatInput }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const missing = await runJob({ jobToken: "01", clock: null, mode: "cli" });
  check(
    "clock_required",
    missing.ok === false && missing.decision === "invalid" && missing.error?.code === "clock_required",
    JSON.stringify(missing.error),
  );
  const badClock = await runJob({ jobToken: "01", clock: "now", mode: "cli" });
  check(
    "clock_invalid",
    badClock.ok === false && badClock.decision === "invalid",
    JSON.stringify(badClock.error),
  );
  const unknown = await runJob({ jobToken: "09", clock: CLOCK, mode: "cli" });
  check(
    "unknown_job_unsupported",
    unknown.ok === false && unknown.decision === "unsupported",
    JSON.stringify(unknown),
  );
}

{
  const dir = mkdtempSync(join(tmpdir(), "s182-badjson-"));
  const bad = join(dir, "nope.json");
  writeFileSync(bad, "{not json");
  try {
    const r = await runJob({
      jobToken: "02",
      inputPath: bad,
      clock: CLOCK,
      mode: "import",
    });
    check(
      "invalid_json",
      r.ok === false && r.decision === "invalid" && r.error?.code === "invalid_json",
      JSON.stringify({ decision: r.decision, ok: r.ok, error: r.error }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const res = spawnCli(["list"]);
  check("cli_list_exit0", res.status === 0, res.stderr);
  check("cli_list_json", (res.stdout || "").includes("s178.consumer-repeat.catalog.v1"), "schema missing");
}

{
  const job = findJob("acquire");
  const pkgPath = examplePath(job, "negative");
  const renamed = join(mkdtempSync(join(tmpdir(), "s182-rename-")), "looks-like-a-package.json");
  const { copyFileSync } = await import("node:fs");
  copyFileSync(pkgPath, renamed);
  const r = await runJob({
    jobToken: "acquire",
    inputPath: renamed,
    clock: CLOCK,
    mode: "cli",
  });
  check(
    "compose_type_from_content_not_filename",
    r.decision === "fail" && r.artifact?.source?.kind === "package",
    JSON.stringify({ decision: r.decision, source: r.artifact?.source }),
  );
  rmSync(dirname(renamed), { recursive: true, force: true });
}

console.log(`\n${failures.length ? "FAILED" : "OK"} ${failures.length} failure(s)`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
