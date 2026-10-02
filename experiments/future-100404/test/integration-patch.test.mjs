import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startMounted, createTestRetained, QA_ROOT } from "./mounted-owner.mjs";
import { retained } from "./caller.mjs";
import { hash } from "../src/value.mjs";

const PACK = fileURLToPath(new URL("../", import.meta.url));
function run(file, env) {
  const child = spawn(process.execPath, [file], { env: { PATH: path.dirname(process.execPath), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let output = ""; let error = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("patch_caller_timeout")); }, 15000);
    child.stdout.on("data", c => { output += c; if (output.length > 32000) child.kill("SIGKILL"); });
    child.stderr.on("data", c => { error += c; if (error.length > 32000) child.kill("SIGKILL"); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output, error }); }); child.once("error", reject);
  });
}
test("unapplied narrow patch works with the existing owner and refuses action-bearing opt-in before HTTP", async () => {
  const f = await startMounted();
  try {
    const fixture = path.join(f.directory, "patch-checkout"); await mkdir(path.join(fixture, "useful-result-reuse"), { recursive: true });
    const original = path.join(QA_ROOT, "useful-result-reuse/grant-caller.mjs"); const before = hash(await readFile(original));
    await cp(original, path.join(fixture, "useful-result-reuse/grant-caller.mjs"));
    const legacyDigest = "task-linked-delivery/experiments/delivery-outcome-100173/src/canonical.mjs";
    await mkdir(path.dirname(path.join(fixture, legacyDigest)), { recursive: true });
    await cp(path.join(QA_ROOT, legacyDigest), path.join(fixture, legacyDigest));
    const copy = path.join(fixture, "experiments/future-100404"); await mkdir(copy, { recursive: true });
    for (const rel of ["src", "bin", "upstream", "package.json"]) await cp(path.join(PACK, rel), path.join(copy, rel), { recursive: true });
    const p = spawnSync("patch", ["--batch", "-p1", "-i", path.join(PACK, "integration/GRANT-CALLER.patch")], { cwd: fixture, encoding: "utf8" });
    assert.equal(p.status, 0, "narrow_patch_did_not_apply");
    const { result } = await createTestRetained(f);
    const contractFile = path.join(f.directory, "retained-contract.json"); await writeFile(contractFile, JSON.stringify(retained()));
    const env = { USEFUL_RESULT_BASE: f.origin, USEFUL_RESULT_GRANT: result.grant, USEFUL_RESULT_DELIVERY_CONTRACT: contractFile,
      USEFUL_RESULT_DELIVERY_RECEIPT: path.join(f.directory, "retained-receipt.json"), USEFUL_RESULT_DELIVERY_LOOPBACK_QA: "1" };
    const caller = path.join(fixture, "useful-result-reuse/grant-caller.mjs");
    const legacy = await run(caller, { USEFUL_RESULT_BASE: f.origin, USEFUL_RESULT_GRANT: result.grant });
    assert.equal(legacy.code, 0); assert.equal(legacy.error, "");
    assert.equal(JSON.parse(legacy.output).decision, "found");
    assert.equal(legacy.output.includes(result.grant), false);
    const accepted = await run(caller, env);
    assert.equal(accepted.code, 0); assert.equal(accepted.error, "");
    assert.equal(accepted.output.includes(result.grant), false);
    assert.equal(JSON.parse(accepted.output).settlement, "unknown");
    const count = f.state.requests.length;
    const mutation = await run(caller, { ...env, USEFUL_RESULT_ACTION: "revoke" });
    assert.equal(mutation.code, 2); assert.equal(f.state.requests.length, count);
    const producerState = await run(caller, { ...env, COMMERCE_DATA_DIR: f.directory });
    assert.equal(producerState.code, 2); assert.equal(producerState.error, "producer_state_present\n");
    assert.equal(f.state.requests.length, count);
    assert.equal(hash(await readFile(original)), before);
  } finally { await f.close(); }
});
