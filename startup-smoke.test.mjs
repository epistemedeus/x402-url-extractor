import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cwd = path.dirname(fileURLToPath(import.meta.url));

async function assertListening(compareFlag) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-startup-smoke-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: "0",
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      OPPORTUNITY_COMPARE_MCP: compareFlag,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 10_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes("x402-merchant listening on :0") || !output.includes("MCP server:  POST /mcp (23 paid tools)")) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  try {
    assert.equal(await listening, true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2_000).unref();
    });
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("production entry reaches the listening state with comparator disabled", () => assertListening(""));
test("production entry reaches the listening state with comparator enabled", () => assertListening("on"));

test("invalid x402 builder code fails closed before listening", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-builder-code-invalid-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: "0",
      COMMERCE_DATA_DIR: dataDir,
      MPP_SECRET_KEY: "",
      PUBLIC_URL: "https://agents.samedaydesk.com",
      X402_BUILDER_CODE: "INVALID-CODE",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  });
  try {
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`invalid builder code did not fail: ${output.slice(-2000)}`)), 10_000);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
      child.once("error", reject);
    });
    assert.notEqual(exit.code, 0);
    assert.equal(output.includes("Invalid builder code"), true);
    assert.equal(output.includes("x402-merchant listening"), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await rm(dataDir, { recursive: true, force: true });
  }
});
