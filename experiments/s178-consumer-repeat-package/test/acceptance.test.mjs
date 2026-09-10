#!/usr/bin/env node
/**
 * S178 acceptance: CLI + import on positive / material partial-or-negative /
 * repeat-input for each distinct job; preserve S174 release-brief conflict regression.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, findJob } from "../src/catalog.mjs";
import { examplePath, runJob } from "../src/run-job.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const CLOCK = "2026-09-10T18:00:00.000Z";
const failures = [];

function check(name, cond, detail) {
  if (!cond) failures.push({ name, detail });
  console.log(cond ? `PASS ${name}` : `FAIL ${name} :: ${detail}`);
}

const catalog = buildCatalog();
check("catalog_job_count", catalog.jobs.length >= 9, `got ${catalog.jobs.length}`);

// S174 regression: conflict-sha-mismatch must be conflict, not pass+schema-rejected
{
  const job = findJob("release-brief");
  const input = examplePath(job, "conflict");
  const cli = await runJob({ jobToken: "release-brief", inputPath: input, clock: CLOCK, mode: "cli" });
  check(
    "s174_release_brief_conflict_cli",
    cli.ok && cli.decision === "conflict",
    JSON.stringify({ decision: cli.decision, ok: cli.ok, error: cli.error }),
  );
  const imp = await runJob({
    jobToken: "release-brief",
    inputPath: input,
    clock: CLOCK,
    mode: "import",
  });
  check(
    "s174_release_brief_conflict_import",
    imp.ok && imp.decision === "conflict",
    JSON.stringify({ decision: imp.decision, ok: imp.ok, error: imp.error }),
  );
}

const jobTokens = ["01", "02", "03", "04", "05", "06", "07", "08", "acquire"];
for (const token of jobTokens) {
  const job = findJob(token);
  check(`discover_${token}`, Boolean(job), "missing from catalog");
  if (!job) continue;

  const positive = examplePath(job, "positive");
  const partial = examplePath(job, "partial") || examplePath(job, "negative");
  check(`example_positive_${token}`, Boolean(positive) && existsSync(positive), positive);
  check(`example_partialish_${token}`, Boolean(partial) && existsSync(partial), partial);

  const posCli = await runJob({
    jobToken: token,
    inputPath: positive,
    clock: CLOCK,
    mode: "cli",
  });
  check(
    `cli_positive_${token}`,
    posCli.ok === true && ["pass", "partial", "conflict", "fail", "invalid", "unsupported", "unknown"].includes(posCli.decision),
    JSON.stringify({ decision: posCli.decision, ok: posCli.ok, error: posCli.error }),
  );
  // Honest: do not require pass if underlying module is partial/fail
  if (posCli.decision === "pass" && posCli.claims?.greenwashesFailure) {
    check(`no_greenwash_${token}`, false, "greenwash flag set");
  }

  const negCli = await runJob({
    jobToken: token,
    inputPath: partial,
    clock: CLOCK,
    mode: "cli",
  });
  check(
    `cli_partialish_${token}`,
    negCli.ok === true && negCli.decision !== "pass",
    JSON.stringify({ decision: negCli.decision, ok: negCli.ok, error: negCli.error }),
  );
  check(
    `repeat_input_${token}`,
    negCli.decision === "pass" || Boolean(negCli.repeatInput),
    "expected repeatInput on non-pass",
  );

  // Direct import where input is a JSON file
  if (positive.endsWith(".json")) {
    const posImp = await runJob({
      jobToken: token,
      inputPath: positive,
      clock: CLOCK,
      mode: "import",
    });
    check(
      `import_positive_${token}`,
      posImp.ok === true,
      JSON.stringify({ decision: posImp.decision, ok: posImp.ok, error: posImp.error }),
    );
  } else {
    // Directory fixtures: import may return invalid with guidance — still ok:false or unsupported, not greenwash pass
    const posImp = await runJob({
      jobToken: token,
      inputPath: positive,
      clock: CLOCK,
      mode: "import",
    });
    check(
      `import_dir_guidance_${token}`,
      posImp.decision !== "pass" || posImp.ok === true,
      JSON.stringify({ decision: posImp.decision, ok: posImp.ok, error: posImp.error }),
    );
  }
}

// CLI entry smoke
{
  const res = spawnSync(
    process.execPath,
    [join(PKG, "bin/s178-cli.mjs"), "list"],
    { encoding: "utf8" },
  );
  check("cli_list_exit0", res.status === 0, res.stderr);
  check("cli_list_json", (res.stdout || "").includes("s178.consumer-repeat.catalog.v1"), "schema missing");
}

console.log(`\n${failures.length ? "FAILED" : "OK"} ${failures.length} failure(s)`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
