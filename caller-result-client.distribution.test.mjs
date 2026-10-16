import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { CALLER_RESULT_CLIENT_ENTRY } from "./caller-result-client-entry.mjs";
import { opportunityPreflight } from "./opportunity-preflight.mjs";
import {
  MAX_ASSET_BYTES,
  loadPublicAcquisition,
  mountPublicAcquisition,
  PUBLIC_ACQUISITION_INDEX_PATH,
} from "./public-acquisition/engine.mjs";
import { mountPublicAcquisitionIfPresent } from "./public-acquisition/optional-mount.mjs";
import { publishCallerAcquisition } from "./caller-result-client/export/publish-combined.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const entry = CALLER_RESULT_CLIENT_ENTRY;
const publicDir = path.join(cwd, "caller-result-client/export/public");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const payer = `0x${"2".repeat(40)}`;
const args = {
  rewardUsd: 10,
  hours: 1,
  hourlyCostUsd: 1,
  selectionProbabilityPct: 80,
  agentAccess: "agent_allowed",
  acceptance: "deterministic",
  settlement: "direct",
};
const FEEDBACK_SHA256 = "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function unusedPort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const combinedEngine = fileURLToPath(new URL("./public-acquisition/engine.mjs", import.meta.url));

async function mountIndex(t) {
  const port = await unusedPort();
  const origin = `http://127.0.0.1:${port}`;
  const app = express();
  const mounted = await mountPublicAcquisitionIfPresent(app, { publicUrl: origin }, combinedEngine);
  assert.equal(mounted.mounted, true);
  assert.equal(mounted.result.files > 21, true);
  const server = await new Promise((resolve) => {
    const listening = app.listen(port, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`${origin}${PUBLIC_ACQUISITION_INDEX_PATH}`, { redirect: "error" });
  assert.equal(response.status, 200);
  const index = await response.json();
  return { origin, index };
}

function indexArchive(index, version) {
  return index.assets.find((asset) => asset.id === "samedaydesk-caller-result" && asset.role === "archive" && asset.version === version);
}

async function fetchAsset(asset) {
  const response = await fetch(asset.alternateUrl);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, asset.bytes);
  assert.equal(sha256(bytes), asset.sha256);
  return bytes;
}

async function recoveryFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "public-caller-recovery-"));
  const dataDir = path.join(directory, "merchant");
  const counts = { verify: 0, settle: 0 };
  const facilitator = createServer(async (req, res) => {
    let output;
    if (req.url === "/supported") output = { kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} };
    else if (req.url === "/verify") {
      counts.verify += 1;
      output = { isValid: true, payer };
    } else if (req.url === "/settle") {
      counts.settle += 1;
      output = { success: true, network: "eip155:8453", payer, transaction: `0x${counts.settle.toString(16).padStart(64, "0")}` };
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(output));
  });
  const facilitatorPort = await listen(facilitator);
  let target;
  let child;
  const proxyState = { loseNextPaidResponse: false, calls: [], requests: 0 };
  const proxy = createServer(async (req, res) => {
    try {
      proxyState.requests += 1;
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const raw = Buffer.concat(chunks);
      const message = raw.length ? JSON.parse(raw.toString()) : null;
      if (message?.method === "tools/call") proxyState.calls.push(message.params.name);
      const response = await fetch(`${target}${req.url}`, {
        method: req.method,
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        ...(raw.length ? { body: raw } : {}),
        redirect: "error",
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (proxyState.loseNextPaidResponse && message?.method === "tools/call"
        && message.params.name !== "recover_paid_result" && message.params._meta?.["x402/payment"]) {
        proxyState.loseNextPaidResponse = false;
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json" });
      res.end(bytes);
    } catch {
      res.destroy();
    }
  });
  const proxyPort = await listen(proxy);
  const endpointUrl = `http://127.0.0.1:${proxyPort}/mcp`;
  async function start(extra = {}) {
    await stop(child);
    const probe = createServer();
    const port = await listen(probe);
    await new Promise((resolve) => probe.close(resolve));
    target = `http://127.0.0.1:${port}`;
    const configFile = path.join(directory, "receiver.json");
    await writeFile(configFile, JSON.stringify({
      dataDir,
      port,
      endpointUrl,
      tenantId: "tenant-a",
      facilitatorUrl: `http://127.0.0.1:${facilitatorPort}`,
      ...extra,
    }));
    child = spawn(process.execPath, ["fixtures/mcp-task-recovery-loopback.mjs", configFile], {
      cwd,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`receiver_timeout ${output.slice(-2000)}`)), 20000);
      const data = (part) => {
        output += part;
        if (output.includes('"ready":true')) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", data);
      child.stderr.on("data", data);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`receiver_exited ${output.slice(-2000)}`));
      });
    });
  }
  async function operation(name = "opportunity_preflight", inputArgs = args) {
    const client = new Client({ name: "public-recovery-receiver", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpointUrl)));
    const catalog = await client.listTools();
    const accepted = catalog.tools.find((tool) => tool.name === name)._meta.x402.accepts[0];
    await client.close();
    const suffix = randomBytes(8).toString("hex");
    const payment = {
      x402Version: 2,
      resource: { url: `mcp://tool/${name}` },
      accepted,
      payload: {
        signature: `0x${"4".repeat(130)}`,
        authorization: {
          from: payer,
          to: accepted.payTo,
          value: accepted.amount,
          validAfter: "0",
          validBefore: String(Math.floor(Date.now() / 1000) + 300),
          nonce: `0x${randomBytes(32).toString("hex")}`,
        },
      },
      extensions: { "payment-identifier": { info: { required: false, id: `recovery_${suffix}` } } },
    };
    const input = {
      endpointUrl,
      tenantId: "tenant-a",
      principalId: "principal-a",
      name,
      arguments: inputArgs,
      payment,
      maxAtomic: accepted.amount,
      operationId: `operation-${suffix}`,
      reservationId: `reservation-${suffix}`,
      grantId: `grant-${suffix}`,
    };
    const grant = {
      ...Object.fromEntries(["endpointUrl", "tenantId", "principalId", "name", "maxAtomic", "operationId", "reservationId", "grantId"].map((key) => [key, input[key]])),
      inputDigest: hash(inputArgs),
      termsDigest: hash(accepted),
      paymentDigest: hash(payment),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      execute: true,
      readResult: true,
      revoked: false,
    };
    const inputFile = path.join(directory, `input-${suffix}.json`);
    const checkpoint = path.join(directory, `checkpoint-${suffix}.json`);
    const grantFile = path.join(directory, `grant-${suffix}.json`);
    await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
    await writeFile(grantFile, JSON.stringify(grant), { mode: 0o600 });
    return { input, grant, inputFile, checkpoint, grantFile };
  }
  function cli(action, op, clientDir) {
    const argv = action === "start"
      ? [action, op.inputFile, op.checkpoint, op.grantFile]
      : [action, op.checkpoint, op.grantFile];
    const processChild = spawn(process.execPath, ["bin/recover-mcp.mjs", ...argv], {
      cwd: clientDir,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    processChild.stdout.on("data", (chunk) => { stdout += chunk; });
    processChild.stderr.on("data", (chunk) => { stderr += chunk; });
    const finished = new Promise((resolve) => {
      const timer = setTimeout(() => processChild.kill("SIGKILL"), 20000);
      processChild.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    return finished.then((code) => {
      assert.equal(stdout.includes(op.input.payment.payload.signature), false);
      assert.equal(stdout.includes(op.input.payment.payload.authorization.nonce), false);
      return { code, stderr, pid: processChild.pid, body: stdout.trim() ? JSON.parse(stdout) : null };
    });
  }
  t.after(async () => {
    await stop(child);
    proxy.closeAllConnections();
    facilitator.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => proxy.close(resolve)),
      new Promise((resolve) => facilitator.close(resolve)),
    ]);
    await rm(directory, { recursive: true, force: true });
  });
  await start();
  return {
    counts,
    proxyState,
    start,
    operation,
    cli,
    handlerCounts: async () => (await fetch(`${target}/fixture-counts`)).json(),
  };
}

test("caller generation keeps the sealed feedback archive and matches the current source", async () => {
  const baseText = spawnSync("git", ["show", "94e45050e9d992ca2eb613cfb3850676217b9fb1:caller-result-client/export/public/manifest.json"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(baseText.status, 0, baseText.stderr);
  const base = JSON.parse(baseText.stdout);
  const manifest = JSON.parse(await readFile(path.join(publicDir, "manifest.json"), "utf8"));
  const retained = manifest.assets.filter((asset) => asset.version === "0.1.0");
  assert.deepEqual(retained, base.assets);
  const frozen = await readFile(path.join(publicDir, "bytes/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz"));
  assert.equal(sha256(frozen), FEEDBACK_SHA256);
  const current = manifest.assets.find((asset) => asset.role === "archive" && asset.version === entry.version);
  assert.equal(current.sha256, entry.sha256);
  assert.equal(current.originalUrl, entry.archiveUrl);
  const packet = await mkdtemp(path.join(tmpdir(), "caller-pack-"));
  try {
  const packed = spawnSync(process.execPath, ["caller-result-client/export/pack.mjs", packet], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  const fresh = JSON.parse(packed.stdout);
  assert.equal(fresh.archiveSha256, entry.sha256);
  assert.equal(fresh.version, entry.version);
  assert.equal(sha256(frozen), FEEDBACK_SHA256);
  const inventory = JSON.parse(await readFile(path.join(publicDir, `inventories/samedaydesk-caller-result-${entry.version}.json`), "utf8"));
  assert.equal(inventory.members.length, current.inventory.memberCount);
  for (const member of inventory.members) {
    const source = await readFile(path.join(cwd, "caller-result-client", member.path));
    assert.equal(source.length, member.bytes, member.path);
    assert.equal(sha256(source), member.sha256, member.path);
  }
  assert.equal(inventory.members.some((member) => member.path === "src/mcp-recovery.mjs"), true);
  assert.equal(inventory.members.some((member) => member.path === "bin/recover-mcp.mjs"), true);
  assert.equal(inventory.members.some((member) => member.path === "src/continuation.mjs"), true);
  const feedbackInventory = JSON.parse(await readFile(path.join(publicDir, "inventories/samedaydesk-caller-result-0.1.0.json"), "utf8"));
  assert.equal(feedbackInventory.members.some((member) => member.path.includes("mcp-recovery") || member.path.includes("recover-mcp")), false);
  } finally {
    await rm(packet, { recursive: true, force: true });
  }
});

test("published index refuses a missing, changed, or oversize caller artifact", async () => {
  const loaded = loadPublicAcquisition({
    manifestPath: path.join(publicDir, "manifest.json"),
    bytesRoot: path.join(publicDir, "bytes"),
  });
  assert.equal(loaded.document.hostedAcquisitionVerified, false);
  assert.equal(loaded.document.paidLaunch, false);
  assert.equal(loaded.document.sourceQualification, "unknown");
  const root = await mkdtemp(path.join(tmpdir(), "caller-artifact-"));
  try {
    const missing = path.join(root, "missing");
    await cp(publicDir, missing, { recursive: true });
    await rm(path.join(missing, "bytes/samedaydesk-caller-result/0.1.1/provenance.json"));
    assert.throws(() => loadPublicAcquisition({
      manifestPath: path.join(missing, "manifest.json"),
      bytesRoot: path.join(missing, "bytes"),
    }), (error) => error.code === "missing_asset");

    const changed = path.join(root, "changed");
    await cp(publicDir, changed, { recursive: true });
    const archivePath = path.join(changed, "bytes/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz");
    const flipped = await readFile(archivePath);
    flipped[flipped.length - 1] ^= 0xff;
    await writeFile(archivePath, flipped);
    assert.throws(() => loadPublicAcquisition({
      manifestPath: path.join(changed, "manifest.json"),
      bytesRoot: path.join(changed, "bytes"),
    }), (error) => error.code === "changed_bytes");

    const oversize = path.join(root, "oversize");
    await cp(publicDir, oversize, { recursive: true });
    await writeFile(path.join(oversize, "bytes/samedaydesk-caller-result/0.1.1/LICENSE"), Buffer.alloc(MAX_ASSET_BYTES + 1));
    assert.throws(() => loadPublicAcquisition({
      manifestPath: path.join(oversize, "manifest.json"),
      bytesRoot: path.join(oversize, "bytes"),
    }), (error) => error.code === "wrong_byte_length");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("combined mount refuses a missing, malformed, or colliding index before serving current status", async () => {
  const sourceRoot = path.join(cwd, "public-acquisition");
  const root = await mkdtemp(path.join(tmpdir(), "combined-caller-refuse-"));
  try {
    const cases = [
      ["missing", async (dir) => {
        await rm(path.join(dir, "bytes/samedaydesk-caller-result/0.1.1/provenance.json"));
        return "missing_asset";
      }],
      ["malformed", async (dir) => {
        const manifestPath = path.join(dir, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const archive = manifest.assets.find((asset) => asset.relativePath.endsWith("samedaydesk-caller-result-0.1.1.tar.gz"));
        archive.sha256 = "0".repeat(64);
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return "changed_bytes";
      }],
      ["collision", async (dir) => {
        const manifestPath = path.join(dir, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const archive = manifest.assets.find((asset) => asset.relativePath.endsWith("samedaydesk-caller-result-0.1.1.tar.gz"));
        manifest.assets.push({ ...archive });
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return "unsafe_addition";
      }],
    ];
    for (const [label, mutate] of cases) {
      const dir = path.join(root, label);
      await cp(sourceRoot, dir, { recursive: true });
      const code = await mutate(dir);
      let registered = false;
      const app = { use() { registered = true; } };
      assert.throws(() => mountPublicAcquisition(app, {
        publicUrl: "http://127.0.0.1",
        manifestPath: path.join(dir, "manifest.json"),
        bytesRoot: path.join(dir, "bytes"),
      }), (error) => error.code === code);
      assert.equal(registered, false, label);
    }
    const collisionRoot = path.join(root, "producer");
    await cp(sourceRoot, collisionRoot, { recursive: true });
    const before = await readFile(path.join(collisionRoot, "manifest.json"));
    const callerPublic = path.join(root, "caller-public");
    await cp(publicDir, callerPublic, { recursive: true });
    const callerManifest = JSON.parse(await readFile(path.join(callerPublic, "manifest.json"), "utf8"));
    const archive = callerManifest.assets.find((asset) => asset.role === "archive" && asset.version === "0.1.1");
    const extraPath = "samedaydesk-caller-result/0.1.1/extra-license.txt";
    callerManifest.assets.push({
      ...archive,
      role: "license",
      filename: "extra-license.txt",
      relativePath: extraPath,
      bytes: 4,
      sha256: sha256(Buffer.from("nope")),
    });
    await writeFile(path.join(callerPublic, "manifest.json"), `${JSON.stringify(callerManifest, null, 2)}\n`);
    await writeFile(path.join(callerPublic, "bytes", extraPath), Buffer.from("nope"));
    assert.throws(() => publishCallerAcquisition({ callerPublic, combinedRoot: collisionRoot }), /role collision/);
    assert.deepEqual(await readFile(path.join(collisionRoot, "manifest.json")), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("advertised caller archive installs recovery with the merchant checkout absent", { timeout: 240_000 }, async (t) => {
  const { index } = await mountIndex(t);
  assert.equal(index.draft, true);
  assert.equal(index.hostedAcquisitionVerified, false);
  assert.equal(index.productionHosted, false);
  assert.equal(index.paidLaunch, false);
  assert.equal(index.measuredSavings, false);
  assert.equal(index.independentDemand, false);
  assert.equal(index.sourceQualification, "unknown");
  const predecessor = spawnSync("git", ["show", "6ea1294b8693f2c655d239f0870800e93bfff040:public-acquisition/manifest.json"], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(predecessor.status, 0, predecessor.stderr);
  const predecessorAssets = JSON.parse(predecessor.stdout).assets;
  assert.equal(predecessorAssets.length, 21);
  const combinedManifest = JSON.parse(await readFile(path.join(cwd, "public-acquisition/manifest.json"), "utf8"));
  for (const asset of predecessorAssets) {
    assert.deepEqual(combinedManifest.assets.find((item) => item.relativePath === asset.relativePath), asset);
  }
  assert.equal(combinedManifest.assets.filter((asset) => asset.id !== "samedaydesk-caller-result").length, 21);
  const roleKeys = combinedManifest.assets.map((asset) => `${asset.id}@${asset.version}:${asset.role}`);
  assert.equal(new Set(roleKeys).size, roleKeys.length);
  const retainedOnIndex = index.assets.filter((asset) => !String(asset.originalUrl).includes("/downloads/samedaydesk-caller-result/"));
  assert.equal(retainedOnIndex.length, 21);
  const current = indexArchive(index, entry.version);
  const feedback = indexArchive(index, "0.1.0");
  assert.equal(current.originalUrl, entry.archiveUrl);
  assert.equal(current.sha256, entry.sha256);
  assert.equal(current.alternateUrl.endsWith(current.alternatePath), true);
  assert.equal(feedback.sha256, FEEDBACK_SHA256);
  assert.equal(feedback.originalUrl, entry.feedbackArchive.archiveUrl);
  const provenanceAsset = index.assets.find((asset) => asset.id === "samedaydesk-caller-result" && asset.role === "provenance" && asset.version === entry.version);
  const provenance = JSON.parse(await (await fetch(provenanceAsset.alternateUrl)).text());
  assert.equal(provenance.sourceQualification, "unknown");
  assert.equal(provenance.hostedAcquisitionVerified, false);
  assert.match(provenance.note, /Download originalUrl and verify sha256 before install/);
  assert.doesNotMatch(provenance.note, /not a hosted acquisition/);
  assert.doesNotMatch(provenance.note, /path convention/);
  assert.equal(provenance.paidLaunch, false);
  assert.equal(provenance.recognizedRevenueAtomic, "0");
  assert.equal(provenance.recovery.optional, true);
  assert.equal(provenance.recovery.charged, false);
  assert.equal(provenance.recovery.packageExport, "./recovery");
  assert.equal(provenance.continuation.optional, true);
  assert.equal(provenance.continuation.charged, false);
  assert.equal(provenance.continuation.packageExport, "./continuation");

  const work = await mkdtemp(path.join(tmpdir(), "caller-public-install-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const feedbackBytes = await fetchAsset(feedback);
  const feedbackDir = path.join(work, "feedback-0.1.0");
  await writeFile(path.join(work, "feedback.tar.gz"), feedbackBytes);
  spawnSync("mkdir", ["-p", feedbackDir]);
  const oldUnpack = spawnSync("tar", ["-xzf", path.join(work, "feedback.tar.gz"), "-C", feedbackDir], { encoding: "utf8" });
  assert.equal(oldUnpack.status, 0, oldUnpack.stderr);
  assert.equal(existsSync(path.join(feedbackDir, "src/mcp-recovery.mjs")), false);
  assert.equal(existsSync(path.join(feedbackDir, "bin/recover-mcp.mjs")), false);
  assert.equal(existsSync(path.join(feedbackDir, "server.js")), false);
  const oldTests = spawnSync(process.execPath, ["--test", "test/client.test.mjs"], {
    cwd: feedbackDir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(oldTests.status, 0, `${oldTests.stdout}\n${oldTests.stderr}`);

  const currentBytes = await fetchAsset(current);
  const archiveName = new URL(entry.archiveUrl).pathname.split("/").pop();
  await writeFile(path.join(work, archiveName), currentBytes);
  const installed = spawnSync("bash", ["-c", `set -e\n${entry.install.join("\n")}`], {
    cwd: work,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, npm_config_fund: "false", npm_config_audit: "false" },
  });
  assert.equal(installed.status, 0, installed.stderr.slice(-2000));
  const unpacked = path.join(work, "samedaydesk-caller-result");
  assert.equal(existsSync(path.join(unpacked, "server.js")), false);
  assert.equal(existsSync(path.join(work, "server.js")), false);
  assert.equal(existsSync(path.join(unpacked, "caller-result-feedback.mjs")), false);
  const merchantImport = spawnSync(process.execPath, ["-e", "import('./caller-result-feedback.mjs').catch((error) => { console.error(error.code || error.message); process.exit(1); })"], {
    cwd: unpacked,
    encoding: "utf8",
  });
  assert.equal(merchantImport.status, 1);
  const pkg = JSON.parse(await readFile(path.join(unpacked, "package.json"), "utf8"));
  assert.equal(pkg.name, "samedaydesk-caller-result");
  assert.equal(pkg.version, entry.version);
  assert.equal(pkg.exports["./mcp"], "./src/mcp-caller-result.mjs");
  assert.equal(pkg.exports["./recovery"], "./src/mcp-recovery.mjs");
  assert.equal(pkg.exports["./continuation"], "./src/continuation.mjs");
  assert.equal(pkg.bin["recover-mcp"], "bin/recover-mcp.mjs");
  assert.equal(existsSync(path.join(unpacked, "src/continuation.mjs")), true);
  assert.deepEqual(pkg.dependencies, entry.sdk);
  const sdk = JSON.parse(await readFile(path.join(unpacked, "node_modules/@modelcontextprotocol/sdk/package.json"), "utf8"));
  const x402 = JSON.parse(await readFile(path.join(unpacked, "node_modules/@x402/mcp/package.json"), "utf8"));
  assert.equal(sdk.version, entry.sdk["@modelcontextprotocol/sdk"]);
  assert.equal(x402.version, entry.sdk["@x402/mcp"]);
  await writeFile(path.join(unpacked, "import-probe.mjs"), [
    'import { startPaidMcpResult, resumePaidMcpResult, mcpRecoveryBudget } from "samedaydesk-caller-result/recovery";',
    'import { bindPaidMcpCallerResult } from "samedaydesk-caller-result/mcp";',
    'import { bindCallerResultFeedback, reportCallerResult } from "samedaydesk-caller-result/http";',
    'if (typeof startPaidMcpResult !== "function" || typeof resumePaidMcpResult !== "function" || typeof mcpRecoveryBudget !== "function") process.exit(2);',
    'if (typeof bindPaidMcpCallerResult !== "function") process.exit(3);',
    'if (typeof bindCallerResultFeedback !== "function" || typeof reportCallerResult !== "function") process.exit(4);',
    'process.stdout.write("imports-ok\\n");',
    "",
  ].join("\n"));
  const imported = spawnSync(process.execPath, ["import-probe.mjs"], {
    cwd: unpacked,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), "imports-ok");
  const usage = spawnSync(process.execPath, ["bin/recover-mcp.mjs"], {
    cwd: unpacked,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage_rejected/);
  const cliText = await readFile(path.join(unpacked, "bin/recover-mcp.mjs"), "utf8");
  assert.equal(cliText.startsWith("#!/usr/bin/env node\n"), true);
  assert.equal(pkg.bin["recover-mcp"], "bin/recover-mcp.mjs");
  const packageTests = spawnSync(process.execPath, ["--test", "test/client.test.mjs", "test/recovery.test.mjs"], {
    cwd: unpacked,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(packageTests.status, 0, `${packageTests.stdout}\n${packageTests.stderr}`);

  await writeFile(path.join(unpacked, "probe-accounting.mjs"), accountingProbeSource());
  const probe = spawnSync(process.execPath, ["probe-accounting.mjs"], {
    cwd: unpacked,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  assert.equal(probe.status, 0, probe.stderr);
  const accounting = JSON.parse(probe.stdout);
  assert.equal(accounting.possibleAtomic, "50000");
  assert.equal(accounting.reportedSettledAtomic, null);
  assert.equal(accounting.settlementSource, "unknown");

  const fixture = await recoveryFixture(t);
  const op = await fixture.operation();
  fixture.proxyState.loseNextPaidResponse = true;
  const first = await fixture.cli("start", op, unpacked);
  assert.equal(first.code, 2, first.stderr);
  assert.equal(first.body.state, "unresolved");
  assert.equal(fixture.counts.verify, 1);
  assert.equal(fixture.counts.settle, 1);
  await fixture.start();
  const cold = await fixture.cli("resume", op, unpacked);
  assert.equal(cold.code, 0, cold.stderr);
  assert.equal(cold.body.state, "completed");
  assert.notEqual(first.pid, cold.pid);
  assert.deepEqual(cold.body.output, opportunityPreflight(args));
  assert.equal(cold.body.output.decision, "attempt");
  assert.equal(cold.body.budget.reportedSettledAtomic, "50000");
  assert.equal(cold.body.budget.newPaymentPermitted, false);
  assert.equal(fixture.counts.verify, 1);
  assert.equal(fixture.counts.settle, 1);
  assert.equal((await fixture.handlerCounts()).opportunity, 0);

  const refused = await fixture.operation();
  fixture.proxyState.loseNextPaidResponse = true;
  const held = await fixture.cli("start", refused, unpacked);
  assert.equal(held.code, 2, held.stderr);
  const requests = fixture.proxyState.requests;
  const verify = fixture.counts.verify;
  const settle = fixture.counts.settle;
  const cases = [
    ["tenant", { tenantId: "tenant-b" }, /grant_tenantId_changed/],
    ["grant", { grantId: "grant-other" }, /grant_grantId_changed/],
    ["origin", { endpointUrl: "https://other.example/mcp" }, /grant_endpointUrl_changed/],
    ["expired", { expiresAt: "2000-01-01T00:00:00.000Z" }, /grant_expired/],
    ["revoked", { revoked: true }, /grant_revoked_or_missing/],
    ["budget", { maxAtomic: "999999" }, /grant_budget_changed/],
  ];
  for (const [label, patch, pattern] of cases) {
    await writeFile(refused.grantFile, JSON.stringify({ ...refused.grant, ...patch }), { mode: 0o600 });
    const result = await fixture.cli("resume", refused, unpacked);
    assert.equal(result.code, 2, `${label} ${result.stderr}`);
    assert.match(result.stderr, pattern, label);
  }
  assert.equal(fixture.proxyState.requests, requests);
  assert.equal(fixture.counts.verify, verify);
  assert.equal(fixture.counts.settle, settle);
  t.diagnostic(JSON.stringify({
    archiveUrl: entry.archiveUrl,
    sha256: entry.sha256,
    version: entry.version,
    firstConsumerCommand: `${entry.install.join(" && ")} && node bin/recover-mcp.mjs resume checkpoint.json grant.json`,
    publishedArchiveCanary: false,
    combinedMountedIndex: true,
    merchantCheckoutPresent: false,
    secondPaidVerify: false,
    secondPaidSettle: false,
  }));
});

function accountingProbeSource() {
  return [
    'import assert from "node:assert/strict";',
    'import { createHash } from "node:crypto";',
    'import { existsSync } from "node:fs";',
    'import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";',
    'import { tmpdir } from "node:os";',
    'import path from "node:path";',
    'import { mcpAccountingDigest, mcpRecoveryBudget, mcpRecoveryFileStore, mcpResultDigest, startPaidMcpResult } from "samedaydesk-caller-result/recovery";',
    'if (existsSync(new URL("./server.js", import.meta.url))) throw new Error("merchant_checkout_present");',
    "const copy = value => structuredClone(value);",
    'const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");',
    'const scope = { endpointUrl: "https://merchant.example/mcp", tenantId: "tenant-a" };',
    'const accepted = { scheme: "exact", network: "eip155:8453", amount: "50000", asset: "0x" + "a".repeat(40), payTo: "0x" + "b".repeat(40) };',
    'const input = { ...scope, name: "opportunity_preflight", principalId: "principal-a", grantId: "grant-a", operationId: "operation-a", reservationId: "reservation-a", maxAtomic: "50000", arguments: { rewardUsd: 10 }, payment: { x402Version: 2, resource: { url: "mcp://tool/opportunity_preflight" }, accepted, payload: { signature: "0x" + "4".repeat(130), authorization: { from: "0x" + "2".repeat(40), to: accepted.payTo, value: accepted.amount, validBefore: String(Math.floor(Date.now() / 1000) + 300) } } } };',
    "const grant = { endpointUrl: input.endpointUrl, tenantId: input.tenantId, principalId: input.principalId, grantId: input.grantId, operationId: input.operationId, reservationId: input.reservationId, name: input.name, maxAtomic: input.maxAtomic, inputDigest: hash(input.arguments), termsDigest: hash(input.payment.accepted), paymentDigest: hash(input.payment), expiresAt: new Date(Date.now() + 300000).toISOString(), execute: true, readResult: true, revoked: false };",
    'const body = { ok: true, decision: "attempt", requiredChecks: [] };',
    'const result = { content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body, _meta: { "x402/payment-response": { success: false } } };',
    'result._meta["samedaydesk/recovery"] = { version: 1, ...scope, persisted: true, resultDigest: mcpResultDigest(result), name: input.name, inputDigest: hash(input.arguments), termsDigest: hash(accepted), paymentDigest: hash(input.payment), contextDigest: hash({ operationId: input.operationId, reservationId: input.reservationId, principalId: input.principalId, grantId: input.grantId }) };',
    'const directory = await mkdtemp(path.join(tmpdir(), "installed-accounting-"));',
    'const file = path.join(directory, "checkpoint.json");',
    "const store = mcpRecoveryFileStore(file);",
    'const client = { listTools: async () => ({ tools: [{ name: input.name, _meta: { x402: { accepts: [accepted] }, samedaydesk: { recovery: { version: 1, tool: "recover_paid_result", ...scope } } } }, { name: "recover_paid_result", _meta: { samedaydesk: { paymentRequired: false } } }] }), callTool: async () => copy(result), close: async () => {} };',
    "const saved = await (await startPaidMcpResult({ client, store, input, loadGrant: async () => copy(grant) })).handoff();",
    "assert.equal(saved.accountingDigest, mcpAccountingDigest(saved.result));",
    'assert.equal(mcpRecoveryBudget(saved).possibleAtomic, "50000");',
    'const bound = JSON.parse(await readFile(file, "utf8"));',
    "const digest = bound.resultDigest;",
    'bound.result._meta["x402/payment-response"].success = true;',
    'await writeFile(file, JSON.stringify(bound) + "\\n", { mode: 0o600 });',
    "await chmod(file, 0o600);",
    "await assert.rejects(store.load(), /checkpoint_result_integrity/);",
    "delete bound.accountingDigest;",
    "bound.resultDigest = digest;",
    'await writeFile(file, JSON.stringify(bound) + "\\n", { mode: 0o600 });',
    "await chmod(file, 0o600);",
    "const legacy = await store.load();",
    "const budget = mcpRecoveryBudget(legacy);",
    'assert.equal(budget.possibleAtomic, "50000");',
    "assert.equal(budget.reportedSettledAtomic, null);",
    'assert.equal(budget.settlementSource, "unknown");',
    "assert.equal(budget.newPaymentPermitted, false);",
    "await rm(directory, { recursive: true, force: true });",
    'process.stdout.write(JSON.stringify({ possibleAtomic: budget.possibleAtomic, reportedSettledAtomic: budget.reportedSettledAtomic, settlementSource: budget.settlementSource }) + "\\n");',
    "",
  ].join("\n");
}
