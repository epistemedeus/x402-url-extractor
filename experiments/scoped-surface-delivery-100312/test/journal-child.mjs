import { createRetention } from "../src/regression.mjs";
import { openJournal } from "../src/journal.mjs";

const [dir, command, id, secret, statement] = process.argv.slice(2);
const journal = openJournal(dir);
if (command === "insert") {
  const generation = journal.transaction((data) => {
    data.rows.push({ id, revision: 1, generation: 1, published: true, marker: id });
    data.generation += 1;
    return { save: true, value: data.generation };
  });
  process.stdout.write(`${JSON.stringify({ ok: true, generation })}\n`);
  process.exit(0);
}
const retention = createRetention({
  journal,
  authorityFile: process.env.SCOPED_SURFACE_AUTHORITY,
  clock: () => process.env.SCOPED_SURFACE_CLOCK || new Date().toISOString(),
  scan: () => {
    throw new Error("scan_not_used");
  },
});
const outcome = command === "revoke"
  ? retention.revoke({ id, ownerContinuation: secret })
  : retention.correct({ id, ownerContinuation: secret, statement });
process.stdout.write(`${JSON.stringify(outcome)}\n`);
process.exit(outcome.revoked === true || outcome.corrected === true ? 0 : 1);
