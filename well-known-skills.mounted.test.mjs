import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  WELL_KNOWN_SKILL_NAMES,
  WELL_KNOWN_SKILLS_CACHE_CONTROL,
  WELL_KNOWN_SKILLS_INDEX_PATH,
  loadWellKnownSkills,
} from "./well-known-skills.mjs";

const cwd = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_URL = "https://agents.samedaydesk.com";

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.once("error", reject);
  });
}

async function startFakeFacilitator() {
  const server = createHttpServer((req, res) => {
    if (req.method === "GET" && req.url === "/supported") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }],
        extensions: [],
        signers: {},
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ isValid: false, success: false }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

async function stopChild(child) {
  if (!child) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000).unref();
  });
}

async function startMerchant(t, extraEnv = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "well-known-skills-"));
  const facilitator = await startFakeFacilitator();
  const port = await unusedPort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd,
    env: {
      ...process.env,
      PORT: String(port),
      COMMERCE_DATA_DIR: dataDir,
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay",
      FACILITATOR_URL: facilitator.url,
      NETWORK: "eip155:8453",
      MPP_SECRET_KEY: "test-secret-key-test-secret-key-32",
      PUBLIC_URL,
      EXTRACT_BATCH_ENABLED: "1",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`startup timed out: ${output.slice(-4000)}`)), 20_000);
      const onData = (chunk) => {
        output = `${output}${chunk}`.slice(-20_000);
        if (output.includes("x402-merchant listening") && output.includes("MCP server:  POST /mcp (23 paid tools)")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`exited before listening: code=${code} signal=${signal}\n${output.slice(-4000)}`));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  } catch (error) {
    await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await stopChild(child);
    await facilitator.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { base, output };
}

function rawRequest(base, rawPath, method = "GET") {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: url.hostname,
      port: url.port,
      path: rawPath,
      method,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("mounted index and SKILL.md match current portable skill source", { timeout: 30_000 }, async (t) => {
  const merchant = await startMerchant(t);
  const indexResponse = await fetch(`${merchant.base}${WELL_KNOWN_SKILLS_INDEX_PATH}`, {
    headers: { Host: "evil.example" },
  });
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get("content-type"), /^application\/json/);
  assert.equal(indexResponse.headers.get("cache-control"), WELL_KNOWN_SKILLS_CACHE_CONTROL);
  assert.equal(indexResponse.headers.get("access-control-allow-origin"), "*");
  assert.match(indexResponse.headers.get("link"), /<https:\/\/agents\.samedaydesk\.com\/\.well-known\/skills\/index\.json>; rel="canonical"/);
  const index = await indexResponse.json();
  const source = loadWellKnownSkills();
  assert.deepEqual(index.skills.map((skill) => skill.name), [...WELL_KNOWN_SKILL_NAMES]);
  for (const [i, skill] of source.entries()) {
    assert.equal(index.skills[i].description, skill.description);
    assert.deepEqual(index.skills[i].files, ["SKILL.md"]);
    const resource = await fetch(`${merchant.base}/.well-known/skills/${skill.name}/SKILL.md`);
    assert.equal(resource.status, 200);
    assert.equal(resource.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(await resource.text(), skill.markdown);
    assert.equal(
      resource.headers.get("link"),
      `<https://agents.samedaydesk.com/.well-known/skills/${skill.name}/SKILL.md>; rel="canonical"`,
    );
  }

  const redirected = await fetch(`${merchant.base}/.well-known/skills`, { redirect: "manual" });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get("location"), `${PUBLIC_URL}${WELL_KNOWN_SKILLS_INDEX_PATH}`);
});

test("mounted negatives: missing file, traversal, unknown name", { timeout: 30_000 }, async (t) => {
  const merchant = await startMerchant(t);
  const negatives = [
    "/.well-known/skills/missing/SKILL.md",
    "/.well-known/skills/web-extract/missing.md",
    "/.well-known/skills/web-extract/%2e%2e/%2e%2e/package.json",
    "/.well-known/skills/../../package.json",
    "/.well-known/skills/web-extract/SKILL.md/..%2f..%2fserver.js",
    "/.well-known/skills/%252e%252e/%252e%252e/package.json",
    "/.well-known/skills/web%2dextract/SKILL.md",
    "/.well-known/skills/web-extract/SKILL.md%00",
    "/.well-known/skills/web-extract//SKILL.md",
    "/.well-known/skills/Invalid_Name/SKILL.md",
    "/.well-known/skills/web-extract/skill.md",
  ];
  for (const route of negatives) {
    const response = await rawRequest(merchant.base, route);
    assert.equal(response.status, 404, `${route} -> ${response.status} ${response.body.slice(0, 80)}`);
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const known = await rawRequest(merchant.base, "/.well-known/skills/web-extract/SKILL.md", method);
    assert.equal(known.status, 405, method);
    const unknown = await rawRequest(merchant.base, "/.well-known/skills/unknown/SKILL.md", method);
    assert.equal(unknown.status, 404, method);
  }
});

test("R8 contest health metadata stays disjoint and MCP remains 23 tools", { timeout: 30_000 }, async (t) => {
  const merchant = await startMerchant(t);
  const skills = await fetch(`${merchant.base}${WELL_KNOWN_SKILLS_INDEX_PATH}`).then((r) => r.json());
  assert.equal(skills.skills.some((skill) => skill.name === "xagent-verification"), false);
  const proof = await fetch(`${merchant.base}/.well-known/xagent-verification.json`);
  assert.equal(proof.status, 404);
  const mcp = await fetch(`${merchant.base}/mcp`).then((r) => r.json());
  assert.equal(mcp.toolCount, 23);
  assert.match(merchant.output, /MCP server:  POST \/mcp \(23 paid tools\)/);
  const card = await fetch(`${merchant.base}/.well-known/agent-card.json`).then((r) => r.json());
  assert.equal(card.skills.some((skill) => skill.id === "web-extract"), false);
  const healthz = await fetch(`${merchant.base}/healthz`).then((r) => r.json());
  assert.equal(healthz.ok, true);
  assert.equal(Object.hasOwn(healthz, "skillsIndex"), false);
});
