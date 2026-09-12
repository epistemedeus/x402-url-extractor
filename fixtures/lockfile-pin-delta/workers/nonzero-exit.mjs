import { compareLockfileTexts } from "../../../vendor/lockfile-pin-delta/lib/compare.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const report = compareLockfileTexts(message.beforeText, message.afterText);
process.stdout.write(`${JSON.stringify({ ok: true, report })}\n`);
process.exit(2);
