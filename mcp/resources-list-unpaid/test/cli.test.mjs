import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "../cli.mjs");
const REPO = join(HERE, "../../..");

function runCli(args, { timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`cli timed out: ${stdout}${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test("CLI cold run lists unpaid resources", { timeout: 20_000 }, async () => {
  const result = await runCli(["--json"]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.command, "cold-run");
  assert.equal(envelope.paymentRequired, false);
  assert.equal(envelope.paymentSent, false);
  assert.equal(envelope.httpStatus, 200);
  assert.equal(envelope.count, 4);
  assert.match(envelope.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test("CLI seeded paid-list is rejected", { timeout: 10_000 }, async () => {
  const result = await runCli(["--seeded-failure", "paid-list", "--json"]);
  assert.equal(result.code, 1, result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.command, "seeded-failure");
  assert.equal(envelope.seed, "paid-list");
  assert.equal(envelope.paymentRequired, false);
  assert.equal(envelope.error.code, "RESOURCES_LIST_PAID");
  assert.equal(envelope.error.capturePaymentRequired, true);
});
