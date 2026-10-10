import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cwd = path.dirname(fileURLToPath(import.meta.url));

test("mounted native MCP caller journey reaches the current handlers", { timeout: 180_000 }, async () => {
  const child = spawn(process.execPath, ["mcp-caller-result.loopback.mjs"], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("loopback timed out"));
    }, 170_000);
    child.once("exit", (status) => {
      clearTimeout(timer);
      resolve(status);
    });
    child.once("error", reject);
  });
  assert.equal(code, 0, `${stdout.slice(-1500)}\n${stderr.slice(-1500)}`);
  const summary = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(summary.outcome, "ready_for_receiving");
  assert.equal(summary.initialFailure, null);
  assert.equal(summary.remainingContract, null);
  assert.equal(summary.controls.coldDeclaredUseful, 1);
  assert.equal(summary.controls.coldDeclaredNotUseful, 1);
  assert.equal(summary.controls.usefulBound, true);
  assert.equal(summary.controls.wrapperReturnedCapability, false);
  assert.equal(summary.controls.hookRetainsCapability, true);
  assert.equal(summary.controls.chainTruth, false);
  assert.equal(summary.counts.parentAdmitted > 0, true);
  assert.equal(summary.counts.declaredUseful, 1);
  assert.equal(summary.counts.declaredNotUseful, 1);
  const encoded = JSON.stringify(summary);
  assert.equal(encoded.includes("eyJ"), false);
  assert.equal(encoded.includes("http://"), false);
  assert.equal(encoded.includes("https://"), false);
});
