#!/usr/bin/env node
// Cold consumer. It scans two supplied task files. It does not replay a fixed
// positive result, and it does not install or execute the supplied trees.

import fs from "node:fs";
import { rankExit, runScan } from "../src/adapter.mjs";
import { ensurePins } from "../src/hydrate.mjs";

const paths = process.argv.slice(2);
if (paths.length !== 2) {
  process.stderr.write("two_tasks_required\n");
  process.exit(64);
}
const tasks = paths.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
const distinct = tasks[0].taskId !== tasks[1].taskId
  && JSON.stringify(tasks[0].files) !== JSON.stringify(tasks[1].files);
if (!distinct) {
  process.stderr.write("tasks_not_distinct\n");
  process.exit(64);
}
const pins = await ensurePins();
const prep = process.hrtime.bigint();
const reports = [];
for (const task of tasks) {
  reports.push(await runScan(task, { skillguardRoot: pins.skillguardRoot }));
}
const body = {
  schema: "samedaydesk.scoped-surface.cold-consumer.v1",
  tasks: tasks.map((task) => task.taskId),
  requesterPrepMicros: Math.round(Number(process.hrtime.bigint() - prep) / 1000),
  reports,
  universalGuarantee: false,
  blanketSafetyScore: null,
  http200IsWork: false,
  cash: "unknown",
  tokens: "unknown",
  profit: "unknown",
  recognizedRevenueAtomic: "0",
};
process.stdout.write(`${JSON.stringify(body)}\n`);
process.exit(rankExit(reports.map((report) => report.exitCode)));
