// Cold visitor journey: fresh node processes save, continue, recover from a
// refusal, and continue offline through the CLI. The server runs in this
// process; each caller step is a new child with no shared memory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { pageChangeRequestExample } from "./page-change-input-contract.mjs";
import { PAGE_CHANGE_MCP_PATH, mountPageChangeMcp } from "./page-change-mcp.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const RECOVER = path.join(cwd, "caller-result-client/bin/continue-free.mjs");
const CLI = path.join(cwd, "examples/customer-x402/bin/page-change.mjs");
const CORRELATION = /^ae:corr:v1:[A-Za-z0-9_-]{22}$/;
const env = {
  PAGE_CHANGE_HTTP_ENABLED: "1",
  PAGE_CHANGE_CONTINUATION_KEYS: `n12b:${"b".repeat(40)},n12a:${"a".repeat(40)}`,
};

// Async spawn: the server shares this event loop, so spawnSync would deadlock.
function run(args, { cwd: dir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: dir, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("child timed out")); }, 60_000);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

async function listen() {
  const app = express();
  mountPageChangeMcp(app, { env });
  const server = createHttpServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${PAGE_CHANGE_MCP_PATH}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("fresh processes save, continue, recover, and continue offline", { timeout: 180_000 }, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "free-continuation-cold-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await listen();
  t.after(() => server.close());
  const example = pageChangeRequestExample();
  const third = structuredClone(example.after);
  third.jobId = "3".repeat(64);
  third.sources[0].data.title = "Synthetic title third";
  const fourth = structuredClone(third);
  fourth.jobId = "4".repeat(64);
  fourth.sources[0].data.title = "Synthetic title fourth";
  const elsewhere = structuredClone(fourth);
  elsewhere.sources[0].source = "https://other.example.invalid/elsewhere";
  const file = (name) => path.join(dir, name);
  await writeFile(file("before.json"), JSON.stringify(example.before));
  await writeFile(file("after.json"), JSON.stringify(example.after));
  await writeFile(file("third.json"), JSON.stringify(third));
  await writeFile(file("fourth.json"), JSON.stringify(fourth));
  await writeFile(file("elsewhere.json"), JSON.stringify(elsewhere));

  // 1. Save through MCP from a fresh process.
  const start = await run([RECOVER, "start", server.url, file("before.json"), file("after.json"), example.fields.join(","), file("chain.json"), "--discovery", "cli"], { cwd: dir });
  assert.equal(start.status, 0, start.stderr);
  const started = JSON.parse(start.stdout);
  assert.equal(started.state, "completed");
  assert.equal(started.output.charged, false);
  assert.equal(started.output.report.verdict, "changed");
  assert.match(started.continuation.correlationId, CORRELATION);
  assert.equal(started.continuation.step, 0);
  assert.equal(started.continuation.tokenHeld, true);
  assert.deepEqual(started.continuation.discovery, { status: "declared", source: "cli" });
  const chain0 = JSON.parse(await readFile(file("chain.json"), "utf8"));
  assert.equal((await stat(file("chain.json"))).mode & 0o777, 0o600);
  assert.equal(start.stdout.includes(chain0.token), false);
  assert.equal(start.stderr.includes(chain0.token), false);

  // 2. Continue through MCP from another fresh process.
  const cont = await run([RECOVER, "continue", file("chain.json"), file("third.json")], { cwd: dir });
  assert.equal(cont.status, 0, cont.stderr);
  const continued = JSON.parse(cont.stdout);
  assert.equal(continued.continuation.correlationId, started.continuation.correlationId);
  assert.equal(continued.continuation.step, 1);
  assert.deepEqual(continued.continuation.discovery, { status: "unknown", source: null });
  const chain1 = JSON.parse(await readFile(file("chain.json"), "utf8"));
  assert.notEqual(chain1.token, chain0.token);
  assert.equal(cont.stdout.includes(chain1.token), false);

  // 3. A tampered saved token is refused with a cue and no echo; the intact
  //    file then recovers the chain.
  const tampered = { ...chain1, token: `${chain1.token.slice(0, -4)}AAAA` };
  await writeFile(file("tampered.json"), JSON.stringify(tampered), { mode: 0o600 });
  const bad = await run([RECOVER, "continue", file("tampered.json"), file("fourth.json")], { cwd: dir });
  assert.equal(bad.status, 2);
  const refused = JSON.parse(bad.stdout);
  assert.equal(refused.state, "refused");
  assert.equal(refused.refusal.code, "continuation_token_invalid");
  assert.equal(refused.refusal.nextMethod, "tools/call");
  assert.equal(refused.refusal.charged, false);
  assert.equal(bad.stdout.includes(tampered.token), false);
  assert.equal(bad.stdout.includes("synthetic.example.invalid"), false);

  // 4. Continue offline through the CLI from the MCP-saved file.
  const offline = await run([CLI, "compare", "--continue", file("chain.json"), "--after", file("fourth.json"), "--save-continuation", file("local.json"), "--discovery", "cli"], { cwd: dir });
  assert.equal(offline.status, 0, offline.stderr);
  const report = JSON.parse(offline.stdout);
  assert.equal(report.schema, "pilot/page-change-brief/v1");
  assert.equal(report.verdict, "changed");
  const local = JSON.parse(await readFile(file("local.json"), "utf8"));
  assert.equal(local.token, null);
  assert.equal(local.correlationId, started.continuation.correlationId);
  assert.equal(local.step, 2);
  assert.deepEqual(local.discovery, { status: "declared", source: "cli" });
  assert.equal(offline.stdout.includes(chain1.token), false);
  assert.equal(offline.stderr.includes(chain1.token), false);

  // 5. CLI refusals: wrong subject and missing second observation.
  const wrong = await run([CLI, "compare", "--continue", file("local.json"), "--after", file("elsewhere.json")], { cwd: dir });
  assert.equal(wrong.status, 2);
  const wrongBody = JSON.parse(wrong.stderr.trim().split("\n").at(-1));
  assert.equal(wrongBody.code, "continuation_subject_mismatch");
  assert.equal(wrongBody.charged, false);
  assert.equal(typeof wrongBody.nextStep, "string");
  assert.equal(wrong.stderr.includes("other.example.invalid"), false);
  assert.equal(wrong.stdout, "");
  const incomplete = await run([CLI, "compare", "--continue", file("local.json")], { cwd: dir });
  assert.equal(incomplete.status, 2);
  assert.equal(JSON.parse(incomplete.stderr.trim()).code, "continuation_second_observation_incomplete");

  // 6. The plain CLI without continuation flags is unchanged.
  const plain = await run([CLI, "compare", "--before", file("before.json"), "--after", file("after.json"), "--fields", example.fields.join(",")], { cwd: dir });
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stderr, "");
  assert.equal(JSON.parse(plain.stdout).verdict, "changed");
});
