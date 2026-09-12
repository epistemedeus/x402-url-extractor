#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { approvalTemplate, BinderRefusal, executeJob, prepareJob } from "../src/binder.mjs";

function parseArgs(argv) {
  const args = { command: argv[0] || "prepare", approve: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--approve") args.approve = true;
    else if (arg.startsWith("--")) args[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function emit(value, code = 0) {
  const stream = code === 0 ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(value)}\n`);
  process.exitCode = code;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.job || !args.stateDir) throw new Error("requires --job <file> --state-dir <dir>");
  if (args.command === "prepare") {
    const prepared = prepareJob({ jobPath: args.job, stateDir: args.stateDir });
    const approvalPath = resolve(prepared.intentDir, "approval-request.json");
    writeFileSync(approvalPath, `${JSON.stringify(approvalTemplate(prepared.intent), null, 2)}\n`, { mode: 0o600 });
    return emit({ ok: true, outcome: prepared.intent.analysis === "informational" ? "no_change" : "approval_required", ...prepared.intent, approvalPath });
  }
  if (args.command === "run") {
    if (!args.approval) throw new Error("run requires --approval <file>");
    const result = await executeJob({
      jobPath: args.job,
      stateDir: args.stateDir,
      approvalPath: args.approval,
      approve: args.approve,
      privateKeyEnv: args.privateKeyEnv,
      customerCli: args.customerCli,
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return emit({ ok: result.code === 0, outcome: result.payload?.outcome || "unknown", intentId: result.intent.intentId, resumeId: result.intent.resumeId, phase: result.phase, childExitCode: result.code }, result.code === 0 ? 0 : 2);
  }
  throw new Error("command must be prepare or run");
}

main().catch((error) => {
  if (error instanceof BinderRefusal) {
    emit({ ok: false, outcome: "refused", code: error.code, message: error.message, detail: error.detail, permissionToSign: false }, 2);
  } else {
    emit({ ok: false, outcome: "unknown", message: error.message, permissionToSign: false }, 1);
  }
});
