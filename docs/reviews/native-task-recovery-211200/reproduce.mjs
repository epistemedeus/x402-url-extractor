// Reproduces the existing full server.js native paid-tool path, before changes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const directory = await mkdtemp(path.join(tmpdir(), "mcp-recovery-admission-"));
const candidate = process.argv.includes("--candidate");
let receiverRoot = root;
if (candidate) {
  // Test the exact shared integration proposal in a disposable source tree.
  // The owning server.js and public/default branches are never edited.
  receiverRoot = path.join(directory, "candidate-source");
  await mkdir(receiverRoot);
  for (const name of await readdir(root)) {
    if (name === "server.js" || name === ".git") continue;
    await symlink(path.join(root, name), path.join(receiverRoot, name));
  }
  const source = await readFile(path.join(root, "server.js"), "utf8");
  const marker = "      tools: mcpTools,\n";
  assert.equal(source.split(marker).length, 2);
  await writeFile(path.join(receiverRoot, "server.js"), source.replace(marker,
    marker + '      nativeRecovery: { journal: idempotencyReplay, endpointUrl: `${PUBLIC_URL}/mcp`, tenantId: "public" },\n'));
}
const payer = `0x${"2".repeat(40)}`;
const counts = { verify: 0, settle: 0 };
const facilitator = createServer((req, res) => {
  let body;
  if (req.url === "/supported") body = { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
  else if (req.url === "/verify") { counts.verify++; body = { isValid: true, payer }; }
  else if (req.url === "/settle") { counts.settle++; body = { success: true, payer, network: "eip155:8453", transaction: `0x${"3".repeat(64)}` }; }
  else { res.writeHead(404); res.end(); return; }
  req.resume();
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body));
});
await new Promise(resolve => facilitator.listen(0, "127.0.0.1", resolve));
let merchant;
async function stop() {
  if (!merchant || merchant.exitCode !== null || merchant.signalCode !== null) return;
  merchant.kill("SIGTERM");
  await new Promise(resolve => {
    const timer = setTimeout(() => merchant.kill("SIGKILL"), 2000);
    merchant.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
async function start() {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  merchant = spawn(process.execPath, ["server.js"], { cwd: receiverRoot, env: {
    PATH: process.env.PATH, PORT: String(port), PUBLIC_URL: "https://agents.samedaydesk.com",
    COMMERCE_DATA_DIR: directory, COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
    FACILITATOR: "xpay", FACILITATOR_URL: `http://127.0.0.1:${facilitator.address().port}`,
    MPP_SECRET_KEY: "", EXTRACT_BATCH_ENABLED: "0",
  }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("merchant_startup_timeout")), 30000);
    const onData = chunk => {
      output = (output + chunk).slice(-16000);
      if (output.includes("MCP server:  POST /mcp")) { clearTimeout(timer); resolve(); }
    };
    merchant.stdout.on("data", onData); merchant.stderr.on("data", onData);
    merchant.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
  });
  return `http://127.0.0.1:${port}/mcp`;
}
async function cold(input) {
  const file = path.join(directory, "input.json");
  await writeFile(file, JSON.stringify(input), { mode: 0o600 });
  const child = spawn(process.execPath, ["docs/reviews/native-task-recovery-211200/original-cold-replay.mjs", file], {
    cwd: root, env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  child.stdout.on("data", value => { out += value; }); child.stderr.on("data", value => { err += value; });
  const code = await new Promise(resolve => child.once("exit", resolve));
  assert.equal(code, 0, err);
  return JSON.parse(out);
}
try {
  let endpoint = await start();
  const args = { rewardUsd: 10, hours: 1, hourlyCostUsd: 1, selectionProbabilityPct: 80,
    agentAccess: "agent_allowed", acceptance: "deterministic", settlement: "direct" };
  const challengeResponse = await fetch(endpoint, { method: "POST", headers: {
    accept: "application/json, text/event-stream", "content-type": "application/json",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: "admission", method: "tools/call", params: { name: "opportunity_preflight", arguments: args } }) });
  const wire = await challengeResponse.text();
  const parsed = JSON.parse(wire.split(/\r?\n/).find(line => line.startsWith("data:"))?.slice(5) || wire);
  const challenge = JSON.parse(parsed.result.content[0].text);
  const accepted = challenge.accepts[0];
  const payment = { x402Version: 2, resource: challenge.resource, accepted,
    payload: { signature: `0x${"4".repeat(130)}`, authorization: { from: payer, to: accepted.payTo,
      value: accepted.amount, validAfter: "0", validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${"5".repeat(64)}` } },
    extensions: { "payment-identifier": { info: { id: "native_recovery_probe_211200", required: false } } } };
  const lost = await cold({ endpoint, args, payment, loseResponse: true });
  assert.equal(lost.lost, true);
  assert.equal(counts.settle, 1);
  await stop(); endpoint = await start();
  const resumed = await cold({ endpoint, args, payment, recoverOnly: candidate });
  const journal = await readFile(path.join(directory, "idempotency-replay.json"), "utf8")
    .then(JSON.parse).catch(error => { if (error.code === "ENOENT") return { records: [] }; throw error; });
  const summary = { seam: "native_paid_mcp_lost_response_process_restart", capabilities: resumed.capabilities,
    decision: JSON.parse(resumed.result.content[0].text).decision, counts,
    replayJournalEntries: journal.records.length, readOnlyResume: candidate, synthetic: true, paidLiveCalls: 0 };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  assert.equal(counts.settle, 1, "cold recovery must not offer the same paid obligation to settlement a second time");
} finally {
  await stop(); facilitator.closeAllConnections();
  await new Promise(resolve => facilitator.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
