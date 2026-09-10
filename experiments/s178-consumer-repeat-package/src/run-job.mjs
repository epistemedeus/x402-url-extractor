/**
 * Run R2-CONSUMER-JOBS-01..08 (+ compose acquisition) via CLI or direct import.
 * Preserves native failures; never greenwashes fail/conflict as pass.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRepeatInput, createResult, normalizeDecision } from "./contract.mjs";
import { findJob } from "./catalog.mjs";

function sourceEntry(path) {
  if (!path || !existsSync(path)) return null;
  const st = statSync(path);
  return {
    path,
    bytes: st.isFile() ? st.size : null,
    kind: st.isDirectory() ? "directory" : "file",
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function examplePath(job, kind = "positive") {
  const rel = job?.examples?.[kind];
  if (!rel) return null;
  const full = join(job.fixtureRoot, rel);
  return existsSync(full) ? full : null;
}

function repeatFor(job, decision, inputPath) {
  if (decision === "pass") return null;
  const suggested = [examplePath(job, "positive"), examplePath(job, "partial")].filter(Boolean);
  const base = {
    jobId: job.jobId,
    artifactId: job.artifactId,
    priorDecision: decision,
    suggestedPaths: [inputPath, ...suggested].filter(Boolean),
  };
  if (decision === "partial") {
    return createRepeatInput({
      ...base,
      reason: "partial_coverage",
      missing: ["fields_or_sources_cited_in_findings"],
      nextActions: [
        "Read findings/limitations for exact gaps",
        "Supply missing fixture fragments and re-run",
        "Do not invent sources or paid outcomes",
      ],
    });
  }
  if (decision === "conflict") {
    return createRepeatInput({
      ...base,
      reason: "conflicting_sources",
      missing: ["authoritative_resolution_input"],
      nextActions: [
        "Choose the authoritative cited source",
        "Re-run with reconciled input",
      ],
    });
  }
  if (decision === "invalid" || decision === "fail") {
    return createRepeatInput({
      ...base,
      reason: decision === "invalid" ? "invalid_input" : "negative_outcome",
      missing: ["shape_valid_input"],
      nextActions: [
        "Compare against the positive example for this job",
        "Fix schema/shape issues listed in native error/findings",
        "Re-run; wrapper envelopes must not be treated as pass",
      ],
    });
  }
  if (decision === "unsupported") {
    return createRepeatInput({
      ...base,
      reason: "unsupported_input_or_dependency",
      missing: ["supported_recipe_or_module"],
      nextActions: ["Run list and pick a ready job", "Read FIRST-USE.md"],
    });
  }
  return createRepeatInput({
    ...base,
    reason: "unknown_outcome",
    nextActions: ["Inspect native payload and limitations"],
  });
}

function mapS137Decision(packet) {
  const schemaRejected = Boolean(
    packet?.error?.code === "schema_rejected" ||
      packet?.cli?.schemaRejected ||
      (packet?.limitations || []).some((l) => /schema[- ]rejected/i.test(String(l))),
  );
  let decision = normalizeDecision(packet?.decision, { schemaRejected });
  if (schemaRejected && decision === "pass") decision = "invalid";
  return decision;
}

function runS137Cli(job, inputPath, clock) {
  const args = [job.cli, "analyze", job.artifactId, "--in", inputPath, "--clock", clock];
  const res = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: job.moduleRoot,
    maxBuffer: 8 * 1024 * 1024,
  });
  let packet = null;
  try {
    packet = JSON.parse(res.stdout || "");
  } catch (err) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "cli",
      ok: false,
      decision: "fail",
      error: {
        code: "cli_failed",
        message: err.message,
        stderr: res.stderr,
        exitCode: res.status,
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
      native: { stdout: (res.stdout || "").slice(0, 2000), stderr: res.stderr },
    });
  }
  const decision = mapS137Decision(packet);
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "cli",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: packet.findings || [],
    limitations: packet.limitations || [],
    native: packet,
    freshness: packet.freshness || null,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

async function importS137(job, inputPath, clock) {
  const schemaUrl = pathToFileURL(join(job.moduleRoot, "src", job.artifactId, "schema.mjs")).href;
  const transformUrl = pathToFileURL(
    join(job.moduleRoot, "src", job.artifactId, "transform.mjs"),
  ).href;
  const schemaMod = await import(schemaUrl);
  const transformMod = await import(transformUrl);

  if (!existsSync(inputPath) || !statSync(inputPath).isFile()) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "import",
      ok: false,
      decision: "invalid",
      error: {
        code: "unsupported_input",
        message: "Direct import requires a JSON file (use CLI for directories)",
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
      repeatInput: repeatFor(job, "invalid", inputPath),
    });
  }

  let input = readJson(inputPath);
  if (
    input &&
    input.input &&
    typeof input.input === "object" &&
    (input.caseId || input.expectedDecision || input.expect)
  ) {
    input = { ...input.input };
  }
  if (clock && input && typeof input === "object" && !input.clock) {
    input = { ...input, clock };
  }

  let schemaRejected = false;
  let schemaError = null;
  if (typeof schemaMod.validateInput === "function") {
    try {
      const v = schemaMod.validateInput(input);
      if (v === false || v?.ok === false) {
        schemaRejected = true;
        schemaError = v?.error || v || { message: "validateInput returned false" };
      }
    } catch (err) {
      schemaRejected = true;
      schemaError = { message: err.message, code: "schema_rejected" };
    }
  }

  const transform =
    transformMod.transform ||
    transformMod.run ||
    transformMod.buildReleaseBrief ||
    transformMod.buildFreshnessReceipt ||
    transformMod.packageReplayPack ||
    transformMod.reconcileTables ||
    transformMod.transformLinkIndex ||
    transformMod.transformMigrationChecklist ||
    transformMod.analyze ||
    transformMod.build;

  if (typeof transform !== "function") {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "import",
      ok: false,
      decision: "unsupported",
      error: {
        code: "missing_transform",
        message: `No transform export for ${job.artifactId}`,
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
    });
  }

  let native;
  try {
    native = await transform(input, { clock });
  } catch (err) {
    const decision = schemaRejected ? "invalid" : "fail";
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "import",
      ok: false,
      decision,
      error: { code: "transform_threw", message: err.message },
      sources: [sourceEntry(inputPath)].filter(Boolean),
      native: { schemaError },
      repeatInput: repeatFor(job, decision, inputPath),
    });
  }

  let decision = mapS137Decision(native);
  if (schemaRejected && (decision === "pass" || decision === "unknown")) {
    decision = "invalid";
  }

  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "import",
    ok: true,
    decision,
    schemaRejected,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native?.findings || [],
    limitations: [
      ...(native?.limitations || []),
      ...(schemaRejected ? ["schema_rejected_on_direct_import"] : []),
    ],
    native: { packet: native, schemaError },
    freshness: native?.freshness || null,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

function runJob07Cli(job, inputPath, clock) {
  const res = spawnSync(process.execPath, [job.cli, "brief", inputPath], {
    encoding: "utf8",
    cwd: job.moduleRoot,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, S178_CLOCK: clock },
  });
  let native = null;
  try {
    native = JSON.parse(res.stdout || "");
  } catch (err) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "cli",
      ok: false,
      decision: "fail",
      error: {
        code: "cli_failed",
        message: err.message,
        stderr: res.stderr,
        exitCode: res.status,
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
    });
  }
  const decision = normalizeDecision(native?.status);
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "cli",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native?.comparisons || [],
    limitations: native?.notes ? [native.notes].flat() : [],
    native,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

async function importJob07(job, inputPath, clock) {
  const mod = await import(pathToFileURL(join(job.moduleRoot, "src", "index.mjs")).href);
  const input = readJson(inputPath);
  const native = mod.buildProcurementBrief(input, {
    clock: () => Date.parse(clock),
  });
  const decision = normalizeDecision(native?.status);
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "import",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native?.comparisons || [],
    limitations: [],
    native,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

function runJob08Cli(job, inputPath, clock) {
  const res = spawnSync(process.execPath, [job.cli, "assemble", inputPath], {
    encoding: "utf8",
    cwd: job.moduleRoot,
    maxBuffer: 4 * 1024 * 1024,
  });
  let native = null;
  try {
    native = JSON.parse(res.stdout || "");
  } catch (err) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "cli",
      ok: false,
      decision: "fail",
      error: {
        code: "cli_failed",
        message: err.message,
        stderr: res.stderr,
        exitCode: res.status,
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
    });
  }
  let decision = normalizeDecision(native?.status || native?.packageStatus);
  const pending = (native?.recipes || []).filter((s) =>
    /unavailable|pending_heavy/i.test(String(s.status || "")),
  );
  if ((decision === "pass" || decision === "ready") && pending.length) {
    decision = "partial";
  }
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "cli",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native?.recipes || [],
    limitations: pending.length
      ? [`${pending.length} recipe slot(s) unavailable_pending_heavy — recorded honestly`]
      : [],
    native,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

async function importJob08(job, inputPath, clock) {
  const mod = await import(pathToFileURL(join(job.moduleRoot, "src", "assemble.mjs")).href);
  const input = readJson(inputPath);
  const fn =
    mod.assembleCustomerResultPackage ||
    mod.assembleCustomerResultPackage ||
    mod.assemble;
  if (typeof fn !== "function") {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "import",
      ok: false,
      decision: "unsupported",
      error: {
        code: "missing_assemble",
        message: `No assemble export (${Object.keys(mod).join(",")})`,
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
    });
  }
  const native = fn(input, { clock: () => Date.parse(clock) });
  let decision = normalizeDecision(native?.status || native?.packageStatus);
  const pending = (native?.recipes || []).filter((s) =>
    /unavailable|pending_heavy/i.test(String(s.status || "")),
  );
  if ((decision === "pass" || decision === "ready") && pending.length) {
    decision = "partial";
  }
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "import",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native?.recipes || [],
    limitations: pending.length
      ? [`${pending.length} recipe slot(s) unavailable_pending_heavy — recorded honestly`]
      : [],
    native,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

function runComposeCli(job, inputPath, clock) {
  const isPackage = /package|rejected/i.test(inputPath);
  const args = [
    job.cli,
    "status",
    isPackage ? "--package" : "--journey",
    inputPath,
    "--json",
  ];
  const res = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: job.moduleRoot,
    maxBuffer: 4 * 1024 * 1024,
  });
  const text = res.stdout || "";
  // Prefer first top-level object; lastIndexOf("{") can slice mid-string path values.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let native = null;
  try {
    const slice =
      start >= 0 && end > start ? text.slice(start, end + 1) : text;
    native = JSON.parse(slice);
  } catch (err) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      clock,
      mode: "cli",
      ok: false,
      decision: "fail",
      error: {
        code: "cli_failed",
        message: err.message,
        stderr: res.stderr,
        exitCode: res.status,
      },
      sources: [sourceEntry(inputPath)].filter(Boolean),
      native: { stdout: text.slice(0, 2000) },
    });
  }
  const decision = normalizeDecision(native.packageStatus);
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "cli",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native.recipes || [],
    limitations: [],
    native,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

async function importCompose(job, inputPath, clock) {
  const mod = await import(
    pathToFileURL(join(job.moduleRoot, "src", "acquisition-status.mjs")).href
  );
  const raw = readJson(inputPath);
  let native;
  if (raw.steps || raw.journeySteps) {
    const extracted = mod.packageFromJourney(raw);
    native = mod.buildAcquisitionStatus(extracted?.pkg || extracted || raw);
  } else {
    native = mod.buildAcquisitionStatus(raw);
  }
  const decision = normalizeDecision(native.packageStatus);
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    clock,
    mode: "import",
    ok: true,
    decision,
    sources: [sourceEntry(inputPath)].filter(Boolean),
    findings: native.recipes || [],
    limitations: [],
    native,
    repeatInput: repeatFor(job, decision, inputPath),
  });
}

export async function runJob({
  jobToken,
  inputPath,
  clock,
  mode = "cli",
  root,
  kitRoot,
  layout,
} = {}) {
  if (!clock) {
    return createResult({
      mode,
      ok: false,
      decision: "invalid",
      error: {
        code: "clock_required",
        message: "Operator --clock ISO-8601 is required; do not invent time",
      },
    });
  }
  const opts = { root, kitRoot, layout };
  const job = findJob(jobToken, opts);
  if (!job) {
    return createResult({
      mode,
      clock,
      ok: false,
      decision: "unsupported",
      error: {
        code: "unknown_job",
        message: `Unknown job token ${JSON.stringify(jobToken)}`,
      },
      repeatInput: createRepeatInput({
        reason: "unknown_job",
        nextActions: ["node bin/s178-cli.mjs list"],
      }),
    });
  }
  const resolvedIn = inputPath ? resolve(inputPath) : examplePath(job, "positive");
  if (!resolvedIn || !existsSync(resolvedIn)) {
    return createResult({
      jobId: job.jobId,
      artifactId: job.artifactId,
      mode,
      clock,
      ok: false,
      decision: "invalid",
      error: {
        code: "missing_input",
        message: `Input not found: ${inputPath || "(default positive example)"}`,
      },
      repeatInput: repeatFor(job, "invalid", inputPath),
    });
  }
  if (job.runner === "s137") {
    return mode === "import"
      ? importS137(job, resolvedIn, clock)
      : runS137Cli(job, resolvedIn, clock);
  }
  if (job.runner === "job07") {
    return mode === "import"
      ? importJob07(job, resolvedIn, clock)
      : runJob07Cli(job, resolvedIn, clock);
  }
  if (job.runner === "job08") {
    return mode === "import"
      ? importJob08(job, resolvedIn, clock)
      : runJob08Cli(job, resolvedIn, clock);
  }
  if (job.runner === "compose") {
    return mode === "import"
      ? importCompose(job, resolvedIn, clock)
      : runComposeCli(job, resolvedIn, clock);
  }
  return createResult({
    jobId: job.jobId,
    artifactId: job.artifactId,
    mode,
    clock,
    ok: false,
    decision: "unsupported",
    error: { code: "no_runner", message: `No runner for ${job.runner}` },
  });
}
