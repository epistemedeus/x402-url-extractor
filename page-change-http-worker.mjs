import { comparePageBatches } from "./examples/customer-x402/src/page-change/compare.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const raw = await readStdin();
let message;
try {
  message = JSON.parse(raw.toString("utf8"));
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: "invalid worker payload", code: "invalid_json" }));
  process.exit(2);
}

if (!message || typeof message !== "object" || Array.isArray(message)) {
  process.stdout.write(JSON.stringify({ ok: false, error: "invalid worker payload", code: "invalid_json" }));
  process.exit(2);
}

try {
  const report = await comparePageBatches(message.before, message.after, message.options || {});
  process.stdout.write(JSON.stringify({ ok: true, report }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: String(error?.message || error),
    code: "compare_failed",
  }));
  process.exit(2);
}
