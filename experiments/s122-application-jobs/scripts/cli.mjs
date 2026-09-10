#!/usr/bin/env node
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { listRecipes, persistResult, runRecipe } from "../recipes/lib/run.mjs";
import {
  captureFromResult,
  compareResultToPacket,
  consumePacket,
} from "../recipes/lib/continue-adapter.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    recipe: { type: "string" },
    prior: { type: "string" },
    "current-fixture": { type: "string" },
    operator: { type: "string" },
    schedule: { type: "string" },
    clock: { type: "string" },
    horizon: { type: "string" },
    "horizon-days": { type: "string" },
    "urgent-days": { type: "string" },
    "watch-cycles": { type: "string" },
    "live-official": { type: "boolean", default: false },
    "live-url": { type: "string" },
    "evidence-class": { type: "string" },
    "out-dir": { type: "string" },
    "write-artifact": { type: "boolean", default: false },
    "replay-payment": { type: "boolean", default: false },
    "continue-out": { type: "string" },
    revision: { type: "string" },
    phase: { type: "string" },
    packet: { type: "string" },
    result: { type: "string" },
    artifact: { type: "string", default: "final-review-inputs" },
    pretty: { type: "boolean", default: true },
  },
});

const command = positionals[0];

const input = {
  priorPath: values.prior ? resolve(values.prior) : undefined,
  currentFixturePath: values["current-fixture"] ? resolve(values["current-fixture"]) : undefined,
  operatorPath: values.operator ? resolve(values.operator) : undefined,
  scheduleHint: values.schedule || null,
  clock: values.clock || null,
  horizonHours: values.horizon != null && values.horizon !== "" ? Number(values.horizon) : null,
  horizonDays: values["horizon-days"] != null && values["horizon-days"] !== "" ? Number(values["horizon-days"]) : null,
  urgentDays: values["urgent-days"] != null && values["urgent-days"] !== "" ? Number(values["urgent-days"]) : null,
  watchCycles: values["watch-cycles"]
    ? values["watch-cycles"].split(",").map((item) => item.trim()).filter(Boolean)
    : undefined,
  liveOfficial: values["live-official"],
  liveUrl: values["live-url"],
  evidenceClass: values["evidence-class"] || undefined,
  replayPayment: values["replay-payment"],
};

if (values.help || (!values.list && !values.recipe && !command)) {
  process.stdout.write(`${usage()}\n`);
  process.exit(values.help ? 0 : 2);
}

if (values.list) {
  process.stdout.write(`${JSON.stringify(listRecipes(), null, 2)}\n`);
  process.exit(0);
}

if (command === "continue") {
  const sub = positionals[1];
  const code = await runContinue(sub);
  process.exit(code);
}

const recipeId = values.recipe || (command && command !== "continue" ? command : null);

const result = await runRecipe(recipeId, input);
const persisted = persistResult(result, {
  outDir: values["out-dir"] ? resolve(values["out-dir"]) : undefined,
  writeArtifact: values["write-artifact"],
});

let continuation = null;
if (values["continue-out"]) {
  continuation = await captureFromResult(result, {
    revision: values.revision || `seq-${(result.prior?.sequence || 0) + 1}`,
    phase: values.phase || "followup",
    outDir: resolve(values["continue-out"]),
    now: result.clock,
  });
}

const output = { ...result, persisted, continuation };
process.stdout.write(`${values.pretty ? JSON.stringify(output, null, 2) : JSON.stringify(output)}\n`);
process.exit(result.ok || result.outcome === "stale_baseline" ? 0 : 1);

async function runContinue(sub) {
  if (sub === "capture") {
    if (!values.result || !values["continue-out"]) {
      process.stderr.write("continue capture requires --result and --continue-out\n");
      return 2;
    }
    const { readFileSync } = await import("node:fs");
    const result = JSON.parse(readFileSync(resolve(values.result), "utf8"));
    const captured = await captureFromResult(result, {
      revision: values.revision || "seq-2",
      phase: values.phase || "followup",
      outDir: resolve(values["continue-out"]),
      now: values.clock || result.clock,
    });
    process.stdout.write(`${JSON.stringify(captured, null, 2)}\n`);
    return captured.ok ? 0 : 1;
  }

  if (sub === "compare") {
    if (!values.packet || !values.result) {
      process.stderr.write("continue compare requires --packet and --result\n");
      return 2;
    }
    const { readFileSync } = await import("node:fs");
    const result = JSON.parse(readFileSync(resolve(values.result), "utf8"));
    const compared = await compareResultToPacket(resolve(values.packet), result);
    process.stdout.write(`${JSON.stringify(compared, null, 2)}\n`);
    return compared.ok ? 0 : 1;
  }

  if (sub === "consume") {
    if (!values.packet || !values["out-dir"]) {
      process.stderr.write("continue consume requires --packet and --out-dir\n");
      return 2;
    }
    const consumed = await consumePacket(resolve(values.packet), {
      outDir: resolve(values["out-dir"]),
      artifact: values.artifact,
    });
    process.stdout.write(`${JSON.stringify({ ok: consumed.ok, execute: false, artifact: consumed.artifact }, null, 2)}\n`);
    return consumed.ok ? 0 : 1;
  }

  if (sub === "correction") {
    if (!values.recipe || !values.packet || !values.prior || !values["current-fixture"] || !values["out-dir"]) {
      process.stderr.write(
        "continue correction requires --recipe --packet --prior --current-fixture --out-dir --schedule --clock\n",
      );
      return 2;
    }
    const second = await runRecipe(values.recipe, input);
    const compared = await compareResultToPacket(resolve(values.packet), second);
    const consumed = await consumePacket(resolve(values.packet), {
      outDir: resolve(values["out-dir"]),
      artifact: values.artifact,
      compareResult: compared.compare,
    });
    const persistedSecond = persistResult(second, {
      outDir: resolve(values["out-dir"]),
      writeArtifact: values["write-artifact"],
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: second.ok || second.outcome === "partial" || second.outcome === "stale_baseline",
          execute: false,
          correction: compared.correction,
          second,
          compared,
          consumed: { status: consumed.artifact?.status, execute: false },
          persisted: persistedSecond,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  process.stderr.write(usage());
  return 2;
}

function usage() {
  return `S122 application job recipes (one-shot; no cron, no daemon, no purchase).

Recipes: npm-cli-release-followup, runtime-eol-watch, agent-cli-release-followup.

Usage:
  node ${rel("scripts/cli.mjs")} --list
  node ${rel("scripts/cli.mjs")} --recipe npm-cli-release-followup \\
    --prior ${rel("fixtures/npm-vercel/prior.seq-1.json")} \\
    --current-fixture ${rel("fixtures/npm-vercel/current.json")} \\
    --operator ${rel("fixtures/npm-vercel/operator.json")} \\
    --schedule weekly --clock 2026-09-10T09:54:59.000Z

  node ${rel("scripts/cli.mjs")} --recipe runtime-eol-watch \\
    --prior ${rel("fixtures/eol-nodejs/prior.seq-1.json")} \\
    --current-fixture ${rel("fixtures/eol-nodejs/current.json")} \\
    --operator ${rel("fixtures/eol-nodejs/operator.json")} \\
    --schedule monthly --clock 2026-09-10T09:54:59.000Z --horizon-days 90

  node ${rel("scripts/cli.mjs")} --recipe agent-cli-release-followup \\
    --prior ${rel("fixtures/npm-claude-code/prior.seq-1.json")} \\
    --current-fixture ${rel("fixtures/npm-claude-code/current.json")} \\
    --operator ${rel("fixtures/npm-claude-code/operator.json")} \\
    --schedule weekly --clock 2026-09-10T09:54:59.000Z

Continue (agent-task-kit 0.1.2, optional TASK_KIT_ROOT):
  ... --continue-out DIR --revision seq-2 --phase followup
  node ${rel("scripts/cli.mjs")} continue compare --packet DIR --result FILE
  node ${rel("scripts/cli.mjs")} continue consume --packet DIR --out-dir DIR
  node ${rel("scripts/cli.mjs")} continue correction --recipe npm-cli-release-followup \\
    --packet DIR --prior FILE --current-fixture FILE --operator FILE \\
    --schedule weekly --clock 2026-09-10T09:54:59.000Z --out-dir DIR

Does not install cron, deploy, purchase, or start an always-on service.
Offline default. --live-official is GET-only against the official JSON allowlist.`;
}

function rel(path) {
  return join("experiments/s122-application-jobs", path);
}
