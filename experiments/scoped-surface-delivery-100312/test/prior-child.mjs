import fs from "node:fs";

import { openJournal } from "../src/journal.mjs";
import { rerun } from "../src/retest.mjs";

const [prior, journalDir, requestPath] = process.argv.slice(2);
const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
const result = await rerun({ prior, request }, {
  skillguardRoot: process.env.SKILLGUARD_ROOT,
  journal: openJournal(journalDir),
});
process.stdout.write(`${JSON.stringify({
  comparison: result.comparison,
  reason: result.reason,
  exitCode: result.exitCode,
  universalGuarantee: result.universalGuarantee,
  spawns: result.operation?.spawns ?? null,
})}\n`);
process.exit(result.comparison === "fixed" ? 0 : result.exitCode || 65);
