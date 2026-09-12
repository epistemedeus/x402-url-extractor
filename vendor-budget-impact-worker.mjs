import { comparePricingTables } from "./vendor/vendor-budget-impact/lib/compare.mjs";
import { buildImpact } from "./vendor/vendor-budget-impact/lib/impact.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

const holdMs = Number(process.env.VENDOR_BUDGET_IMPACT_WORKER_HOLD_MS || 0);
if (Number.isFinite(holdMs) && holdMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, holdMs));
}
if (String(process.env.VENDOR_BUDGET_IMPACT_WORKER_CRASH || "").trim() === "1") {
  emit({ ok: false, code: "engine-crash", error: "injected worker crash" }, 1);
}
if (String(process.env.VENDOR_BUDGET_IMPACT_WORKER_HUGE_STDOUT || "").trim() === "1") {
  process.stdout.write(`${"x".repeat(8_192)}\n`);
  process.exit(0);
}

let message;
try {
  message = JSON.parse((await readStdin()).toString("utf8"));
} catch {
  emit({ ok: false, code: "invalid_json", error: "invalid worker payload" }, 2);
}

if (!message || typeof message !== "object" || Array.isArray(message)) {
  emit({ ok: false, code: "invalid_json", error: "invalid worker payload" }, 2);
}
if (!message.before || !message.after) {
  emit({ ok: false, code: "invalid_json", error: "worker requires before and after objects" }, 2);
}

try {
  const report = comparePricingTables(message.before, message.after);
  if (report?.ok !== true) {
    emit({
      ok: false,
      refused: true,
      code: "engine-refuse",
      error: "pricing compare refused after admission",
      report,
    }, 2);
  }
  const impact = buildImpact(report);
  emit({ ok: true, report, impact }, 0);
} catch (error) {
  emit({
    ok: false,
    code: "engine-crash",
    error: String(error?.message || error),
  }, 1);
}
