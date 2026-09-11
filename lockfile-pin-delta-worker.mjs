import { compareLockfileTexts } from "./vendor/lockfile-pin-delta/lib/compare.mjs";
import { CliRefuse } from "./vendor/lockfile-pin-delta/lib/errors.mjs";

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

const holdMs = Number(process.env.LOCKFILE_PIN_DELTA_WORKER_HOLD_MS || 0);
if (Number.isFinite(holdMs) && holdMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, holdMs));
}
if (String(process.env.LOCKFILE_PIN_DELTA_WORKER_CRASH || "").trim() === "1") {
  emit({ ok: false, code: "engine-crash", error: "injected worker crash" }, 1);
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
if (typeof message.beforeText !== "string" || typeof message.afterText !== "string") {
  emit({ ok: false, code: "invalid_json", error: "worker requires beforeText and afterText" }, 2);
}

try {
  const report = compareLockfileTexts(message.beforeText, message.afterText);
  emit({ ok: true, report }, 0);
} catch (error) {
  if (error instanceof CliRefuse) {
    emit({
      ok: false,
      refused: true,
      code: error.code,
      error: error.message,
      detail: error.detail || {},
    }, 2);
  }
  emit({
    ok: false,
    code: "engine-crash",
    error: String(error?.message || error),
  }, 1);
}
