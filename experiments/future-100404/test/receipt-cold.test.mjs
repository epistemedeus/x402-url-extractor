import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile, stat, symlink, link, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contract, danger } from "./caller.mjs";
import { startMounted, testDirectory } from "./mounted-owner.mjs";
import { prepareDelivery, evaluateReceipt, verifyReceipt } from "../src/consumer.mjs";
import { reserveReceipt, readJsonFile } from "../src/receipt-file.mjs";

const PACK = fileURLToPath(new URL("../", import.meta.url));
async function acquiredClient(directory) {
  const client = path.join(directory, "acquired-client"); await mkdir(client);
  for (const rel of ["src", "bin", "upstream", "package.json"]) await cp(path.join(PACK, rel), path.join(client, rel), { recursive: true });
  return client;
}
function runClient(client, args) {
  const child = spawn(process.execPath, [path.join(client, "bin/service-delivery.mjs"), ...args], {
    cwd: client, env: { PATH: path.dirname(process.execPath) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; let error = "";
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("cold_client_timeout")); }, 15000);
    child.stdout.on("data", chunk => { output += chunk; if (output.length > 32000) child.kill("SIGKILL"); });
    child.stderr.on("data", chunk => { error += chunk; if (error.length > 32000) child.kill("SIGKILL"); });
    child.once("error", reject);
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, output, error }); });
  });
  return { child, promise };
}
function args(file, receipt, origin) { return ["capture", "--contract", file, "--receipt", receipt, "--origin", origin, "--loopback-qa"]; }

test("two stripped acquired processes retain and later validate changed caller work without owner tokens", async () => {
  const f = await startMounted();
  try {
    const client = await acquiredClient(f.directory);
    const c = contract(); c.request.input.files[0].text += "// service-delivery-404-private-sentinel\n";
    const input = path.join(f.directory, "caller.json"); const receipt = path.join(f.directory, "caller-receipt.json");
    await writeFile(input, JSON.stringify(c));
    const first = await runClient(client, args(input, receipt, f.origin)).promise;
    assert.equal(first.code, 0); assert.equal(first.error, "");
    assert.equal(first.output.includes("service-delivery-404-private-sentinel"), false);
    assert.equal((await stat(receipt)).mode & 0o777, 0o600);
    assert.equal(verifyReceipt(await readJsonFile(receipt)).state, "captured");
    // A different cold process has only the public runtime and caller receipt.
    const second = await runClient(client, ["inspect", "--receipt", receipt]).promise;
    assert.equal(second.code, 0); assert.equal(second.error, "");
    assert.equal(JSON.parse(second.output).settlement, "not_attempted");
    const next = danger(); next.taskId = "later-task"; next.request.input.taskId = next.taskId;
    const input2 = path.join(f.directory, "later.json"); const receipt2 = path.join(f.directory, "later-receipt.json");
    await writeFile(input2, JSON.stringify(next));
    const later = await runClient(client, ["validate", "--contract", input2, "--prior", receipt, "--receipt", receipt2, "--origin", f.origin, "--loopback-qa"]).promise;
    assert.equal(later.code, 0);
    const summary = JSON.parse(later.output);
    assert.equal(summary.relation.task, "different_task"); assert.equal(summary.priorMayApply, false);
    assert.equal(summary.rightsInherited, false); assert.equal(summary.settlementInherited, false);
  } finally { await f.close(); }
});
test("simultaneous cold callers reserve one receipt and perform one HTTP operation", async () => {
  const f = await startMounted();
  try {
    const client = await acquiredClient(f.directory); const input = path.join(f.directory, "caller.json"); const receipt = path.join(f.directory, "receipt.json");
    await writeFile(input, JSON.stringify(contract()));
    const results = await Promise.all([runClient(client, args(input, receipt, f.origin)).promise, runClient(client, args(input, receipt, f.origin)).promise]);
    assert.equal(results.some(r => r.code === 0), true);
    assert.equal(f.state.requests.filter(r => r.method === "POST").length, 1);
    assert.equal((await readJsonFile(receipt)).state, "captured");
    const recovery = await runClient(client, args(input, receipt, f.origin)).promise;
    assert.equal(recovery.code, 0); assert.equal(JSON.parse(recovery.output).recoveredExistingReceipt, true);
    assert.equal(f.state.requests.filter(r => r.method === "POST").length, 1);
  } finally { await f.close(); }
});
test("lost terminal output recovers the completed file and a killed in-flight caller remains unknown without another POST", async () => {
  const f = await startMounted({ intercept(req, res, next, state) {
    if (!state.delay || req.path !== "/commerce/scoped-surface-scan") return next();
    const timer = setTimeout(next, 1000); res.once("close", () => clearTimeout(timer));
  } });
  try {
    const client = await acquiredClient(f.directory); const input = path.join(f.directory, "caller.json"); await writeFile(input, JSON.stringify(contract()));
    const complete = path.join(f.directory, "complete.json");
    await runClient(client, args(input, complete, f.origin)).promise; // Discard the reply deliberately.
    const recovered = await runClient(client, args(input, complete, f.origin)).promise;
    assert.equal(recovered.code, 0); assert.equal(JSON.parse(recovered.output).recoveredExistingReceipt, true);
    f.state.delay = true; const pending = path.join(f.directory, "pending.json");
    const lost = runClient(client, args(input, pending, f.origin));
    const deadline = Date.now() + 5000;
    while (f.state.requests.filter(r => r.method === "POST").length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(f.state.requests.filter(r => r.method === "POST").length, 2);
    lost.child.kill("SIGKILL"); await lost.promise;
    const noRetry = await runClient(client, args(input, pending, f.origin)).promise;
    const summary = JSON.parse(noRetry.output);
    assert.equal(noRetry.code, 3); assert.equal(summary.verdict, "unknown"); assert.equal(summary.automaticReplay, false);
    assert.equal(f.state.requests.filter(r => r.method === "POST").length, 2);
    assert.equal(evaluateReceipt(await readJsonFile(pending)).reason, "reply_outcome_unknown");
  } finally { await f.close(); }
});
test("wrong task, corrupt receipt, symlink and hard-link inputs never overwrite caller history or start another operation", async () => {
  const dir = await testDirectory();
  try {
    const file = path.join(dir, "receipt.json"); const prepared = prepareDelivery(contract(), "http://127.0.0.1:1234", { allowLoopback: true });
    assert.equal((await reserveReceipt(file, prepared)).acquired, true);
    const before = await readFile(file);
    const changed = contract(); changed.request.input.files[0].text = "changed caller bytes";
    await assert.rejects(() => reserveReceipt(file, prepareDelivery(changed, prepared.origin, { allowLoopback: true })), /receipt_scope_conflict/);
    assert.deepEqual(await readFile(file), before);
    await symlink(file, path.join(dir, "symbolic.json"));
    await assert.rejects(() => readJsonFile(path.join(dir, "symbolic.json")));
    await link(file, path.join(dir, "hard.json"));
    await assert.rejects(() => readJsonFile(file), /file_bounds_or_type/);
    await writeFile(path.join(dir, "torn.json"), "{unfinished");
    await assert.rejects(() => readJsonFile(path.join(dir, "torn.json")), /file_json_invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
