import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceExport } from "../scripts/export-source.mjs";
import { hash } from "../src/value.mjs";
import { startMounted } from "./mounted-owner.mjs";

function run(file, args, cwd) {
  const child = spawn(process.execPath, [file, ...args], { cwd, env: { PATH: path.dirname(process.execPath) }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let output = ""; let error = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("acquired_client_timeout")); }, 15000);
    child.stdout.on("data", b => { output += b; if (output.length > 32000) child.kill("SIGKILL"); });
    child.stderr.on("data", b => { error += b; if (error.length > 32000) child.kill("SIGKILL"); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output, error }); });
    child.once("error", e => { clearTimeout(timer); reject(e); });
  });
}
test("exact source archive acquires a closed caller runtime; changed bytes fail inventory without new owner authority", async () => {
  const f = await startMounted();
  try {
    const sealed = process.env.SERVICE_DELIVERY_USE_SEALED_EXPORT === "1";
    const out = sealed ? fileURLToPath(new URL("../export/", import.meta.url)) : path.join(f.directory, "source-export");
    const exported = sealed ? JSON.parse(await readFile(path.join(out, "SOURCE-EXPORT.json"), "utf8")) : await buildSourceExport({ outputDirectory: out });
    const archive = path.join(out, exported.archive);
    assert.equal(hash(await readFile(archive)), exported.sha256);
    const list = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" }); assert.equal(list.status, 0);
    const entries = list.stdout.trim().split("\n");
    assert.ok(entries.every(p => p.startsWith("future-100404/") && !p.split("/").includes("..")));
    assert.ok(entries.every(p => !p.includes(".runtime/") && !p.includes("node_modules/") && !p.includes("receipts/")));
    const unpack = path.join(f.directory, "acquired"); await mkdir(unpack);
    assert.equal(spawnSync("tar", ["-xzf", archive, "-C", unpack], { encoding: "utf8" }).status, 0);
    const acquired = path.join(unpack, "future-100404");
    const inventory = await readFile(path.join(acquired, "SOURCE-INVENTORY.json"));
    assert.equal(hash(inventory), exported.inventorySha256);
    const verifyFile = path.join(acquired, "scripts/verify-source.mjs");
    const verify = await run(verifyFile, [], acquired);
    assert.equal(verify.code, 0); assert.equal(verify.error, "");
    assert.equal(JSON.parse(verify.output).membersVerified, exported.memberCount);
    const receipt = path.join(f.directory, "acquired-receipt.json");
    const cli = path.join(acquired, "bin/service-delivery.mjs");
    const received = await run(cli, ["capture", "--contract", path.join(acquired, "examples/scan-contract.json"),
      "--receipt", receipt, "--origin", f.origin, "--loopback-qa"], acquired);
    assert.equal(received.code, 0); assert.equal(received.error, "");
    assert.equal(JSON.parse(received.output).currentValidationPerformed, true);
    const later = await run(cli, ["inspect", "--receipt", receipt], acquired);
    assert.equal(later.code, 0); assert.equal(JSON.parse(later.output).currentValidationPerformed, false);
    assert.equal(f.state.requests.filter(r => r.method === "POST").length, 1);
    assert.equal(exported.privateReceiptsIncluded, false); assert.equal(exported.publicHostingObserved, false);
    await appendFile(path.join(acquired, "src/consumer.mjs"), "\n// changed acquired bytes\n");
    const changed = await run(verifyFile, [], acquired);
    assert.equal(changed.code, 2); assert.equal(JSON.parse(changed.output).error, "source_verification_failed");
  } finally { await f.close(); }
});
