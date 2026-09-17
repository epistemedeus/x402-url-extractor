#!/usr/bin/env node
/**
 * Cold follow-the-doc runner for docs/agent-x402/howto.
 * Serves a committed unpaid MCP catalog on loopback, executes tagged
 * fences from how-to.md, and replays seeded failures. No payment.
 */
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_PROTOCOL,
  FORBIDDEN_SCHEME,
  HERE,
  LIVE_MCP_URL,
  MCP_PROTOCOL,
  Rejected,
  assertDiscoveryInventory,
  assertExactOnlyAccepts,
  hasPaymentHeaders,
  rejectSeededDocument,
} from "./rpc.mjs";

const docsDir = HERE;
const howtoPath = join(docsDir, "how-to.md");
const readmePath = join(docsDir, "README.md");
const fixtureCatalog = join(docsDir, "fixtures/seeded-failures.json");
const loopbackCatalogPath = join(docsDir, "fixtures/loopback-catalog.json");
const rpcPath = join(docsDir, "rpc.mjs");
const repoRoot = resolve(docsDir, "../../..");

const FENCE_RE =
  /<!--\s*follow-the-doc:(step|seeded-failure)\s+id=([A-Za-z0-9_-]+)\s*-->\s*```(?:bash|sh)?\n([\s\S]*?)```/g;

const REQUIRED_STEPS = ["initialize", "tools-list", "unpaid-402"];
const REQUIRED_CLI_FAILURES = [
  "batch-settlement",
  "tools-call-paid",
  "payment-header-initialize",
  "mcp-method-header",
  "registry-publish",
];

function extractTagged(md) {
  const steps = [];
  const failures = [];
  const re = new RegExp(FENCE_RE.source, "g");
  let m;
  while ((m = re.exec(md))) {
    const item = { kind: m[1], id: m[2], script: m[3].replace(/\s+$/, "") };
    if (item.kind === "step") steps.push(item);
    else failures.push(item);
  }
  return { steps, failures };
}

function readDocs() {
  const howto = readFileSync(howtoPath, "utf8");
  const readme = readFileSync(readmePath, "utf8");
  const tagged = extractTagged(howto);
  return { howto, readme, steps: tagged.steps, failures: tagged.failures };
}

function pinCheck(docs) {
  const fixture = JSON.parse(readFileSync(fixtureCatalog, "utf8"));
  const catalog = JSON.parse(readFileSync(loopbackCatalogPath, "utf8"));
  const problems = [];
  const texts = [
    ["how-to.md", docs.howto],
    ["README.md", docs.readme],
  ];
  for (const [name, text] of texts) {
    if (text.includes("\uFEFF")) problems.push(`${name} has a BOM`);
    if (!text.includes(MCP_PROTOCOL)) problems.push(`${name} is missing protocol ${MCP_PROTOCOL}`);
    if (!text.includes("extract_batch")) problems.push(`${name} is missing extract_batch`);
    if (!/\bextract\b/.test(text)) problems.push(`${name} is missing extract`);
    if (!text.includes(FORBIDDEN_SCHEME)) problems.push(`${name} is missing the batch-settlement refusal`);
    if (/neomorphic/i.test(text)) problems.push(`${name} mentions neomorphic`);
    if (/smithery.*publish|mcp-publisher|\/v0\.1\/publish/i.test(text) && name === "how-to.md") {
      /* how-to may mention the kill URL only as a refusal; require "kill" nearby */
    }
  }
  if (docs.howto.includes("enable @circle-fin") || docs.readme.includes("enable @circle-fin")) {
    problems.push("docs must not enable @circle-fin/x402-batching");
  }
  if (catalog.protocolVersion !== MCP_PROTOCOL) problems.push("loopback catalog protocol drift");
  if (catalog.serverInfo?.name !== "x402-data-gateway") problems.push("loopback catalog serverInfo.name drift");
  try {
    assertDiscoveryInventory(catalog.tools);
  } catch (error) {
    problems.push(`loopback catalog inventory: ${error.message}`);
  }
  for (const id of REQUIRED_STEPS) {
    if (!docs.steps.some((s) => s.id === id)) problems.push(`missing step ${id}`);
  }
  for (const id of REQUIRED_CLI_FAILURES) {
    if (!docs.failures.some((s) => s.id === id)) problems.push(`missing seeded fence ${id}`);
  }
  for (const spec of fixture.failures) {
    if (spec.kind === "cli" && !docs.failures.some((s) => s.id === spec.id)) {
      problems.push(`fixture ${spec.id} has no tagged fence`);
    }
    if (spec.fixture) {
      const path = join(docsDir, "fixtures", spec.fixture);
      try {
        const doc = JSON.parse(readFileSync(path, "utf8"));
        if (doc.id !== spec.id) problems.push(`${spec.fixture} id drift`);
      } catch (error) {
        problems.push(`cannot read ${spec.fixture}: ${error.message}`);
      }
    }
  }
  if (fixture.protocolVersion !== MCP_PROTOCOL) problems.push("seeded-failures protocol drift");
  if (fixture.forbiddenScheme !== FORBIDDEN_SCHEME) problems.push("seeded-failures scheme pin drift");
  return { ok: problems.length === 0, problems, fixture, catalog };
}

function spawnAsync(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (c) => { stdout += c.toString("utf8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf8"); });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectP(err);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveP({
        status: timedOut ? 124 : status ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function jsonRpc(id, result, error) {
  const body = { jsonrpc: "2.0", id };
  if (error) body.error = error;
  else body.result = result;
  return `${JSON.stringify(body)}\n`;
}

function paymentRequiredResult(toolName, catalog) {
  const tool = catalog.tools.find((item) => item.name === toolName) || catalog.tools[0];
  const accepts = tool?._meta?.x402?.accepts || [{
    scheme: "exact",
    network: "eip155:8453",
    resource: { url: "https://agents.samedaydesk.com/extract" },
  }];
  assertExactOnlyAccepts(accepts, "loopback 402 accepts");
  const body = {
    x402Version: 2,
    error: "Payment required",
    accepts,
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function readJsonBody(req) {
  return new Promise((resolveP, rejectP) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > 1_000_000) {
        req.destroy();
        rejectP(new Error("request too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolveP(null);
        return;
      }
      try {
        resolveP(JSON.parse(raw));
      } catch {
        rejectP(new Error("invalid json"));
      }
    });
    req.on("error", rejectP);
  });
}

export function serveLoopbackMcp(catalog) {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = String(req.url || "/").split("?")[0];
      if (req.method !== "POST" || urlPath !== "/mcp") {
        res.writeHead(urlPath === "/mcp" ? 405 : 404);
        res.end(urlPath === "/mcp" ? "method not allowed" : "missing");
        return;
      }
      if (hasPaymentHeaders(req.headers)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "payment headers are forbidden on unpaid discovery" },
        }));
        return;
      }
      if (req.headers["mcp-method"]) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Mcp-Method header is forbidden on initialize-era discovery" },
        }));
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
        return;
      }
      const id = body?.id ?? null;
      const method = body?.method;
      if (method === "initialize") {
        const requested = body?.params?.protocolVersion;
        if (requested === FORBIDDEN_PROTOCOL) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(jsonRpc(id, {
            protocolVersion: FORBIDDEN_PROTOCOL,
            capabilities: {},
            serverInfo: catalog.serverInfo,
          }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(jsonRpc(id, {
          protocolVersion: MCP_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: catalog.serverInfo,
        }));
        return;
      }
      if (method === "notifications/initialized") {
        res.writeHead(202);
        res.end();
        return;
      }
      if (method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(jsonRpc(id, { tools: catalog.tools }));
        return;
      }
      if (method === "tools/call") {
        const name = body?.params?.name;
        const meta = body?.params?._meta;
        if (meta && typeof meta === "object" && (meta["x402/payment"] || meta.x402)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(jsonRpc(id, null, {
            code: -32600,
            message: "tools/call with payment is paid; unpaid discovery does not settle",
          }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(jsonRpc(id, paymentRequiredResult(name, catalog)));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(jsonRpc(id, null, { code: -32601, message: `unknown method ${method}` }));
    } catch {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end("error");
      } else {
        res.destroy();
      }
    }
  });
  return new Promise((resolveP) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveP({
        origin: `http://127.0.0.1:${port}/mcp`,
        port,
        stop: () => new Promise((done) => {
          server.close(() => done());
          if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        }),
      });
    });
  });
}

function bashEnv({ origin, cwd, stateDir }) {
  return {
    ...process.env,
    MCP_ORIGIN: origin,
    MCP_STATE_DIR: stateDir,
    TMPDIR: cwd,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    NO_PROXY: "*",
  };
}

function lastJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const start = trimmed.lastIndexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}

function matchOutput(r, pattern) {
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  return new RegExp(pattern, "i").test(text);
}

export function expectSeededRejected(spec, r) {
  if (!spec?.expect) return r.status !== 0;
  const expect = spec.expect;
  if (expect.exitNonZero && r.status === 0) return false;
  if (expect.outputMatches && !matchOutput(r, expect.outputMatches)) return false;
  return true;
}

async function runHappyPath({ origin, cwd, docs, stateDir }) {
  const parts = [];
  for (const step of docs.steps) {
    parts.push(`# step ${step.id}\n${step.script}\n`);
  }
  const script = `set -euo pipefail
${parts.join("\n")}
`;
  return spawnAsync("bash", ["-c", script], {
    cwd: repoRoot,
    env: bashEnv({ origin, cwd, stateDir }),
  });
}

async function runCliFailure({ origin, cwd, stateDir, fence }) {
  const script = `set -euo pipefail
set +e
${fence.script}
status=$?
set -e
exit $status
`;
  return spawnAsync("bash", ["-c", script], {
    cwd: repoRoot,
    env: bashEnv({ origin, cwd, stateDir }),
  });
}

function rejectDocumentFixture(spec) {
  const path = join(docsDir, "fixtures", spec.fixture);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const expectReject = doc.expectReject || spec.expect?.outputMatches;
  let reason;
  try {
    rejectSeededDocument(doc);
    throw new Error(`${path} was not rejected`);
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    reason = error.message;
  }
  if (expectReject && reason !== expectReject) {
    throw new Error(`${path} rejected with ${JSON.stringify(reason)}, expected ${JSON.stringify(expectReject)}`);
  }
  return { id: spec.id, rejected: true, exitCode: 1, reason };
}

function parseArgs(argv) {
  const out = { json: true, seededFailure: null, live: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") out.json = true;
    else if (a === "--live") out.live = true;
    else if (a === "--seeded-failure") {
      out.seededFailure = args[i + 1] || "";
      i += 1;
    } else if (a.startsWith("--seeded-failure=")) {
      out.seededFailure = a.slice("--seeded-failure=".length);
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--") {
      break;
    } else if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    } else if (["publish", "registry", "pay", "payment", "checkout", "call", "tools/call"].includes(a)) {
      out.kill = a;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage:
  node docs/agent-x402/howto/follow-the-doc.mjs
  node docs/agent-x402/howto/follow-the-doc.mjs --seeded-failure batch-settlement
  node docs/agent-x402/howto/follow-the-doc.mjs --live

Serves a committed unpaid MCP catalog on loopback, follows tagged fences
in how-to.md, and requires seeded failures to be refused. No payment.
`);
}

export async function runFollowTheDoc({ seededFailure = null, live = false } = {}) {
  const docs = readDocs();
  const pins = pinCheck(docs);
  const fixture = pins.fixture;
  const knownIds = new Set(fixture.failures.map((f) => f.id));
  const wanted = seededFailure && seededFailure !== "all"
    ? [seededFailure]
    : fixture.failures.map((f) => f.id);
  const unknownWanted = wanted.filter((id) => !knownIds.has(id));

  if (!pins.ok) {
    return {
      ok: false,
      code: "pin-drift",
      surface: "mcp-unpaid-discovery",
      protocolVersion: MCP_PROTOCOL,
      paid: false,
      pins,
      discovery: null,
      seededFailures: [],
      problems: pins.problems,
    };
  }

  if (unknownWanted.length) {
    return {
      ok: false,
      code: "unknown-seeded-failure",
      surface: "mcp-unpaid-discovery",
      protocolVersion: MCP_PROTOCOL,
      paid: false,
      liveMerchantPay: false,
      discovery: null,
      seededFailures: [],
      problems: unknownWanted.map((id) => `unknown seeded-failure ${id}`),
    };
  }

  const work = mkdtempSync(join(tmpdir(), "ftd-x402-howto-"));
  const stateDir = join(work, "state");
  const seeded = [];
  let discovery = null;
  try {
    const needHappy = !seededFailure || seededFailure === "all"
      || wanted.some((id) => fixture.failures.find((f) => f.id === id)?.kind === "cli");
    let origin = live ? LIVE_MCP_URL : null;
    let loopback = null;
    if (!live) {
      loopback = await serveLoopbackMcp(pins.catalog);
      origin = loopback.origin;
    }
    try {
      if (needHappy) {
        const r = await runHappyPath({ origin, cwd: work, docs, stateDir });
        const parsed = lastJson(r.stdout);
        discovery = {
          exitCode: r.status,
          origin,
          live,
          initializeOk: /"protocolVersion":\s*"2025-11-25"/.test(r.stdout),
          toolsListOk: /"extractPresent":\s*true/.test(r.stdout) && /"extractBatchPresent":\s*true/.test(r.stdout),
          unpaid402Ok: /"paymentRequired":\s*true/.test(r.stdout) && /"handlerRan":\s*false/.test(r.stdout),
          batchSettlement: /"batchSettlement":\s*true/.test(r.stdout),
          paymentAttempted: /"paymentAttempted":\s*true/.test(r.stdout),
          last: parsed,
          stdoutTail: String(r.stdout || "").slice(-1200),
          stderrTail: String(r.stderr || "").slice(-800),
        };

        if (r.status === 0) {
          for (const spec of fixture.failures) {
            if (!wanted.includes(spec.id) || spec.kind !== "cli") continue;
            const fence = docs.failures.find((f) => f.id === spec.id);
            if (!fence) {
              seeded.push({ id: spec.id, rejected: false, exitCode: 1, output: "missing tagged fence" });
              continue;
            }
            const fr = await runCliFailure({ origin, cwd: work, stateDir, fence });
            seeded.push({
              id: spec.id,
              rejected: expectSeededRejected(spec, fr),
              exitCode: fr.status,
              output: `${fr.stdout}\n${fr.stderr}`.slice(0, 800),
            });
          }
        }
      }

      for (const spec of fixture.failures) {
        if (!wanted.includes(spec.id) || spec.kind !== "document") continue;
        try {
          seeded.push(rejectDocumentFixture(spec));
        } catch (error) {
          seeded.push({
            id: spec.id,
            rejected: false,
            exitCode: 0,
            output: error.message,
          });
        }
      }
    } finally {
      if (loopback) await loopback.stop();
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const wantedCli = wanted.filter((id) => fixture.failures.find((f) => f.id === id)?.kind === "cli");
  const happyOk = discovery
    ? Boolean(
      discovery.exitCode === 0
      && discovery.initializeOk
      && discovery.toolsListOk
      && discovery.unpaid402Ok
      && discovery.batchSettlement === false
      && discovery.paymentAttempted === false,
    )
    : wantedCli.length === 0;
  const seededOk = seeded.length === wanted.length && seeded.every((s) => s.rejected === true);
  const problems = [];
  if (!happyOk) problems.push("howto follow-the-doc did not succeed");
  if (!seededOk) problems.push("a seeded failure was not rejected");
  if (discovery && discovery.exitCode !== 0 && (!seededFailure || seededFailure === "all")) {
    problems.push(`howto exit ${discovery.exitCode}`);
  }

  return {
    ok: happyOk && seededOk && pins.ok,
    surface: "mcp-unpaid-discovery",
    protocolVersion: MCP_PROTOCOL,
    paid: false,
    liveMerchantPay: false,
    live,
    batchSettlement: false,
    discovery,
    seededFailures: seeded,
    problems,
  };
}

const isMain = Boolean(process.argv[1])
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (isMain) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) {
      printHelp();
      process.exit(0);
    }
    if (args.kill) {
      const publishKill = args.kill === "publish" || args.kill === "registry";
      const line = publishKill
        ? "KILL: publish/registry is out of scope for MCP unpaid discovery"
        : "KILL: payment/checkout is out of scope for MCP unpaid discovery";
      process.stdout.write(`${JSON.stringify({
        ok: false,
        killed: true,
        command: args.kill,
        reason: line,
        paymentAttempted: false,
        registryPublishAttempted: false,
        checkoutMutated: false,
      }, null, 2)}\n`);
      process.stderr.write(`${line}\n`);
      process.exit(2);
    }
    const result = await runFollowTheDoc({
      seededFailure: args.seededFailure,
      live: args.live,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      code: "runner-error",
      message: String(err?.message || err),
    }, null, 2)}\n`);
    process.exit(1);
  }
}

export { pinCheck, readDocs, rpcPath };
