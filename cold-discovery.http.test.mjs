import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";

import { selectPurchaseEvidenceLink } from "agent-payment-policy";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://agents.samedaydesk.com";
const EXTRACT_URL = `${ORIGIN}/extract?url=https%3A%2F%2Fexample.com`;
const PAY_TO = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const NETWORK = "eip155:8453";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AMOUNT = "5000";
const ROUTE_LOCK_ARCHIVE = "https://neomorphic.io/downloads/route-lock/0.1.0/route-lock-0.1.0.tgz";
const ROUTE_LOCK_LOCK = "https://neomorphic.io/downloads/route-lock/0.1.0/package-lock.json";
const ROUTE_LOCK_ARCHIVE_SHA = "6f1b59e96eb4e6b222a0f5ac4db6cc9375a0f703e642b841f4c7de4bfa570cbf";
const ROUTE_LOCK_LOCK_SHA = "eed6f8c3e417faed7bb70151c96acffc0ed6ee57d30fea7138b7dea18cba0666";
const LIVE_EXTRACT = "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relationUrls(linkHeader, relation) {
  if (typeof linkHeader !== "string") return [];
  const urls = [];
  for (const part of linkHeader.split(/,(?=\s*<)/)) {
    const target = part.match(/<([^>]+)>/);
    const rel = part.match(/;\s*rel=(?:"([^"]+)"|([^;]+))/i);
    const tokens = String(rel?.[1] || rel?.[2] || "").split(/\s+/).filter(Boolean);
    if (target && tokens.includes(relation)) urls.push(target[1]);
  }
  return urls;
}

async function readJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} ${response.status}`);
  return response.json();
}

function publicGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: "GET",
      headers: {
        accept: "application/json",
        host: "agents.samedaydesk.com",
        "x-forwarded-host": "agents.samedaydesk.com",
        "x-forwarded-proto": "https",
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(res.headers)) {
          if (value == null) continue;
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else headers.set(name, value);
        }
        resolve({ status: res.statusCode, headers, body: Buffer.concat(chunks) });
      });
    });
    req.once("error", reject);
    req.end();
  });
}

async function installRouteLock() {
  const root = await mkdtemp(path.join(tmpdir(), "route-lock-public-"));
  const archivePath = path.join(root, "route-lock-0.1.0.tgz");
  const lockPath = path.join(root, "package-lock.json");
  const archive = Buffer.from(await (await fetch(ROUTE_LOCK_ARCHIVE)).arrayBuffer());
  const lock = Buffer.from(await (await fetch(ROUTE_LOCK_LOCK)).arrayBuffer());
  assert.equal(archive.length, 20149);
  assert.equal(lock.length, 16327);
  assert.equal(sha256(archive), ROUTE_LOCK_ARCHIVE_SHA);
  assert.equal(sha256(lock), ROUTE_LOCK_LOCK_SHA);
  await writeFile(archivePath, archive);
  await writeFile(lockPath, lock);
  const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", root], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  await writeFile(path.join(root, "package", "package-lock.json"), lock);
  const installed = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: path.join(root, "package"),
    encoding: "utf8",
  });
  assert.equal(installed.status, 0, installed.stderr);
  return { root, packageDir: path.join(root, "package") };
}

function decide(packageDir, request) {
  const input = path.join(packageDir, `input-${process.hrtime.bigint()}.json`);
  spawnSync("mkdir", ["-p", packageDir]);
  return writeFile(input, `${JSON.stringify(request)}\n`).then(() => {
    const result = spawnSync(process.execPath, ["src/cli.mjs", "decide", "--input", input], {
      cwd: packageDir,
      encoding: "utf8",
    });
    let parsed = null;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      parsed = null;
    }
    return { status: result.status ?? 1, parsed, stderr: result.stderr || "" };
  });
}

function catalogRecord(catalog, method, route) {
  const matches = [];
  for (const item of catalog.items || []) {
    const itemMethod = String(item?.request?.method || "").toUpperCase();
    const raw = item?.resource?.url;
    if (itemMethod !== method || typeof raw !== "string") continue;
    const url = new URL(raw);
    if (url.origin !== ORIGIN || url.pathname !== route) continue;
    const accept = (item.accepts || []).find((entry) => entry && typeof entry === "object");
    matches.push({
      source: "x402-catalog",
      protocol: accept?.scheme === "exact" ? "x402" : undefined,
      method: itemMethod,
      url: url.toString(),
      amountAtomic: accept?.amount,
      network: accept?.network,
      asset: accept?.asset,
      recipient: accept?.payTo,
    });
  }
  return matches;
}

test("compiled extract challenge links the generated OpenAPI document and x402 catalog", { timeout: 180_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "samedaydesk-cold-discovery-"));
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      PUBLIC_URL: ORIGIN,
      X402_BUILDER_CODE: "bc_samedaydesk_test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-2000)}`)), 30_000);
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-20_000);
      if (!output.includes(`x402-merchant listening on :${port}`)) return;
      clearTimeout(timer);
      resolve(true);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`startup exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
    });
  });
  t.after(async () => {
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
  });
  assert.equal(await listening, true);
  const base = `http://127.0.0.1:${port}`;
  const challengeResponse = await publicGet(port, `/extract?url=${encodeURIComponent("https://example.com")}`);
  assert.equal(challengeResponse.status, 402);
  const challengeBody = JSON.parse(challengeResponse.body.toString("utf8"));
  const link = challengeResponse.headers.get("link") || "";
  const evidenceUrl = selectPurchaseEvidenceLink(link, EXTRACT_URL);
  assert.equal(evidenceUrl, `${ORIGIN}/.well-known/agent-payment-evidence.json`);
  assert.deepEqual(relationUrls(link, "service-desc"), [
    `${ORIGIN}/openapi.json`,
    `${ORIGIN}/.well-known/x402`,
  ]);
  const challenge = JSON.parse(Buffer.from(challengeResponse.headers.get("payment-required"), "base64").toString("utf8"));
  const accept = challenge.accepts[0];
  assert.equal(accept.amount, AMOUNT);
  assert.equal(accept.payTo, PAY_TO);
  assert.equal(accept.network, NETWORK);
  assert.equal(accept.asset, ASSET);
  assert.equal(challenge.resource.url, EXTRACT_URL);
  assert.equal(challenge.extensions?.["builder-code"]?.info?.a, "bc_samedaydesk_test");
  assert.equal(challenge.extensions?.bazaar?.info?.input?.method, "GET");
  assert.equal(typeof challenge.extensions?.bazaar?.info?.output?.example, "object");
  assert.notEqual(challenge.extensions?.bazaar?.info?.output?.example?.openapi, "3.1.0");

  const [openapi, catalog, evidence] = await Promise.all([
    readJson(`${base}/openapi.json`),
    readJson(`${base}/.well-known/x402`),
    readJson(`${base}/.well-known/agent-payment-evidence.json`),
  ]);
  const operation = openapi.paths?.["/extract"]?.get;
  assert.equal(openapi.openapi, "3.1.0");
  assert.ok(operation, "generated OpenAPI is missing GET /extract");
  const schema = operation.responses?.["200"]?.content?.["application/json"]?.schema;
  assert.equal(schema.properties.description.type.includes("null"), true);
  assert.equal(schema.properties.error.type.includes("null"), true);
  assert.equal(schema.required.includes("description"), false);
  assert.equal(schema.required.includes("error"), false);
  assert.equal(operation["x-payment-info"]?.operation?.price, AMOUNT);
  assert.equal(operation["x-payment-info"]?.protocols?.[0]?.x402?.network, NETWORK);
  assert.equal(operation["x-payment-info"]?.protocols?.[0]?.x402?.asset, ASSET);
  const records = catalogRecord(catalog, "GET", "/extract");
  assert.equal(records.length, 1);
  assert.equal(records[0].amountAtomic, AMOUNT);
  assert.equal(records[0].recipient, PAY_TO);
  assert.equal(records[0].network, NETWORK);
  assert.equal(records[0].asset, ASSET);
  assert.equal(records[0].url, EXTRACT_URL);
  const requiredPaths = evidence.operations.find((item) => item.method === "GET" && item.path === "/extract")?.output?.requiredPaths;
  assert.ok(requiredPaths?.includes("ok"));

  const observedAt = new Date(challengeResponse.headers.get("date")).toISOString();
  const request = {
    schemaVersion: "route-lock.decision-request.v1",
    now: observedAt,
    validityWindowMs: Number(accept.maxTimeoutSeconds) * 1000,
    subject: {
      id: "unpaid-challenge",
      origin: ORIGIN,
      method: "GET",
      route: "/extract",
      invocationUrl: EXTRACT_URL,
      requiredPaths,
      catalogs: records.map((record) => ({
        source: record.source,
        protocol: record.protocol,
        method: record.method,
        url: record.url,
        amountAtomic: record.amountAtomic,
        network: record.network,
        asset: record.asset,
        recipient: record.recipient,
      })),
      documents: { x402: openapi },
      runtime: {
        status: 402,
        observedAt,
        headers: {
          "payment-required": challengeResponse.headers.get("payment-required"),
          "www-authenticate": challengeResponse.headers.get("www-authenticate"),
        },
      },
      profile: {
        x402Scheme: "exact",
        network: NETWORK,
        mppMethod: "evm",
        mppIntent: "charge",
      },
    },
  };
  const routeLock = await installRouteLock();
  t.after(() => rm(routeLock.root, { recursive: true, force: true }));
  const ready = await decide(routeLock.packageDir, request);
  assert.equal(ready.status, 0, JSON.stringify(ready.parsed || ready.stderr));
  assert.equal(ready.parsed.decision, "lockable");
  assert.equal(ready.parsed.code, "six_dimension_settlement_ready");
  assert.equal(ready.parsed.identity.publicRoute, `GET ${ORIGIN}/extract`);
  assert.deepEqual(ready.parsed.identity.queryKeys, ["url"]);
  process.stdout.write(`COMPILED decision=${ready.parsed.decision} code=${ready.parsed.code} route=${ready.parsed.identity.publicRoute}\n`);

  const mapperPath = path.resolve(cwd, "../neo/packages/route-release-decision/scripts/map-challenge.mjs");
  if (existsSync(mapperPath)) {
    const { mapDocumentedChallenge } = await import(pathToFileURL(mapperPath).href);
    const mapped = mapDocumentedChallenge({
      requestUrl: EXTRACT_URL,
      status: 402,
      headers: {
        date: challengeResponse.headers.get("date"),
        "payment-required": challengeResponse.headers.get("payment-required"),
        link,
        "www-authenticate": challengeResponse.headers.get("www-authenticate"),
      },
      body: challengeBody,
      describedBy: [{ url: evidenceUrl, status: 200, body: evidence }],
      serviceDescriptions: relationUrls(link, "service-desc").map((url) => ({
        url,
        status: 200,
        body: url.endsWith("/openapi.json") ? openapi : catalog,
      })),
    });
    assert.equal(mapped.catalogCopied, true);
    assert.equal(mapped.openApiCopied, true);
    assert.equal(mapped.request.subject.catalogs[0].url, EXTRACT_URL);
    assert.equal(mapped.request.subject.method, "GET");
    assert.equal(mapped.request.subject.route, "/extract");
    assert.equal(mapped.absentEvidence.includes("output_example_is_not_openapi"), false);
    const mappedDecision = await decide(routeLock.packageDir, mapped.request);
    assert.equal(mappedDecision.status, 0, mappedDecision.stderr);
    assert.equal(mappedDecision.parsed.decision, "lockable");
    assert.equal(mappedDecision.parsed.code, "six_dimension_settlement_ready");
    process.stdout.write(`MAPPED decision=${mappedDecision.parsed.decision} code=${mappedDecision.parsed.code} route=${mappedDecision.parsed.identity.publicRoute}\n`);
  }

  const absent = structuredClone(request);
  delete absent.subject.documents.x402.paths["/extract"].get.responses["200"].content["application/json"].schema;
  const rejected = await decide(routeLock.packageDir, absent);
  assert.equal(rejected.status, 3, rejected.stderr);
  assert.equal(rejected.parsed.decision, "skip");
  assert.notEqual(rejected.parsed.decision, "lockable");
  process.stdout.write(`SEEDED decision=${rejected.parsed.decision} code=${rejected.parsed.code}\n`);

  const malformed = structuredClone(request);
  malformed.subject.documents.x402.paths["/extract"].get.responses["200"].content["application/json"].schema = { $ref: "#/Missing" };
  const malformedDecision = await decide(routeLock.packageDir, malformed);
  assert.notEqual(malformedDecision.parsed?.decision, "lockable");
  process.stdout.write(`MALFORMED decision=${malformedDecision.parsed?.decision} code=${malformedDecision.parsed?.code}\n`);

  const changed = structuredClone(request);
  const payment = JSON.parse(Buffer.from(changed.subject.runtime.headers["payment-required"], "base64").toString("utf8"));
  payment.accepts[0].payTo = `${PAY_TO.slice(0, -1)}0`;
  changed.subject.runtime.headers["payment-required"] = Buffer.from(JSON.stringify(payment)).toString("base64");
  const changedDecision = await decide(routeLock.packageDir, changed);
  assert.equal(changedDecision.parsed.decision, "skip");
  assert.equal(changedDecision.parsed.code, "recipient_changed");
  process.stdout.write(`RECIPIENT decision=${changedDecision.parsed.decision} code=${changedDecision.parsed.code}\n`);

  const stale = structuredClone(request);
  stale.subject.runtime.observedAt = "2020-01-01T00:00:00.000Z";
  const staleDecision = await decide(routeLock.packageDir, stale);
  assert.equal(staleDecision.parsed.decision, "skip");
  assert.equal(staleDecision.parsed.code, "terms_stale");
  assert.equal(staleDecision.parsed.evidence.fresh, false);
  process.stdout.write(`STALE decision=${staleDecision.parsed.decision} code=${staleDecision.parsed.code} fresh=${staleDecision.parsed.evidence.fresh}\n`);

  const alone = await decide(routeLock.packageDir, {
    schemaVersion: "route-lock.decision-request.v1",
    now: observedAt,
    authority: {
      method: "GET",
      url: EXTRACT_URL,
      protocol: "x402",
      amountAtomic: AMOUNT,
      network: NETWORK,
      asset: ASSET,
      recipient: PAY_TO,
    },
    current: {
      method: "GET",
      url: EXTRACT_URL,
      protocol: "x402",
      amountAtomic: AMOUNT,
      network: NETWORK,
      asset: ASSET,
      recipient: PAY_TO,
      availability: { status: 402 },
      evidence: { observedAt },
    },
  });
  assert.equal(alone.parsed.decision, "skip");
  assert.equal(alone.parsed.code, "readiness_dimensions_absent");
  process.stdout.write(`ALONE decision=${alone.parsed.decision} code=${alone.parsed.code}\n`);

});

test("deployed extract advertises machine documentation", {
  skip: process.env.COLD_DISCOVERY_LIVE !== "1",
}, async () => {
  const live = await fetch(LIVE_EXTRACT, { signal: AbortSignal.timeout(20_000) });
  assert.equal(live.status, 402);
  const liveLink = live.headers.get("link") || "";
  assert.deepEqual(relationUrls(liveLink, "service-desc"), [`${ORIGIN}/openapi.json`, `${ORIGIN}/.well-known/x402`]);
  assert.equal(selectPurchaseEvidenceLink(liveLink, LIVE_EXTRACT), `${ORIGIN}/.well-known/agent-payment-evidence.json`);
  await live.body?.cancel();
  process.stdout.write(`LIVE status=${live.status} service-desc=true describedby=agent-payment-evidence\n`);
});
