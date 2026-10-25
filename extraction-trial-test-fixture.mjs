import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { provisionExtractionTrial } from "./extraction-trial.mjs";

export const ROOT = fileURLToPath(new URL("./", import.meta.url));
export const BASE = "fb88d0b5cc6c6bfa5c65ad1b59cf025c77b7e0b8";
export const NOW = Date.parse("2026-10-25T08:50:00.000Z");
export const authority = (overrides = {}) => ({ schema: "samedaydesk.extraction-trial-budget.v1", experimentId: "owner-fixture-only", startsAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 86400_000).toISOString(), maxStarted: 20, ...overrides });
export async function waitFor(fn, message = "condition", timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timeout: ${message}`);
}
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; }

export async function fixture(t) {
  const scratch = await mkdtemp(path.join(tmpdir(), "root7540-"));
  const calls = [], sourceCalls = [], merchants = new Set();
  let gate = null;
  const source = createServer(async (req, res) => {
    sourceCalls.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith("/gate")) await gate;
    if (req.url.startsWith("/slow")) return; // client deadline aborts; no timer/process leak
    if (req.url.startsWith("/redirect-private")) { res.writeHead(302, { location: "http://127.0.0.1/private-marker" }); return res.end(); }
    if (req.url.startsWith("/redirect-loop")) { res.writeHead(302, { location: "/redirect-loop" }); return res.end(); }
    if (req.url.startsWith("/redirect-ok")) { res.writeHead(302, { location: "/chosen-final" }); return res.end(); }
    const status = req.url.startsWith("/refused") ? 403 : req.url.startsWith("/error") ? 500 : 200;
    res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    if (req.url.startsWith("/oversize")) return res.end("<body>" + "x".repeat(3_000_001) + "</body>");
    if (req.url.startsWith("/excerpt")) return res.end("<body>" + "e".repeat(2000) + "</body>");
    return res.end(`<html lang="en"><head><title>Caller-selected page</title><meta name="description" content="Controlled caller page"></head><body><h1>Useful heading</h1><p>selected ${req.url}</p><a href="/next">next</a></body></html>`);
  });
  const sourcePort = await listen(source);
  const facilitator = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(req.url === "/supported" ? 200 : 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} }));
  });
  const facilitatorPort = await listen(facilitator);
  const hook = path.join(scratch, "hook.mjs");
  await writeFile(hook, `
import { Server } from 'node:net';
import http from 'node:http';
import { publicFetch } from ${JSON.stringify(new URL("./extract-batch-c1/public-fetch.mjs", import.meta.url).href)};
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [${NOW}])); }
  static now() { return ${NOW}; }
};
const listen = Server.prototype.listen;
Server.prototype.listen = function(port, ...args) { return listen.call(this, port, '127.0.0.1', ...args); };
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (u.origin !== 'http://127.0.0.1:${facilitatorPort}' || u.pathname !== '/supported') throw new Error('root7540_forbidden_fetch');
  return realFetch(input, init);
};
globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = 300;
globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = (input, init) => {
  const url = new URL(input);
  if (url.pathname === '/invalid-response') return { status: 200, headers: new Headers(), body: null };
  assertHeaders(init.headers);
  return publicFetch(input, init, {
    lookup: async host => [{ address: host === 'private-dns.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
    request(url, options, callback) {
      // Only the socket destination changes in this disposable transport.
      // publicFetch has already checked DNS. No production hook/environment bypass.
      return http.request({ ...options, hostname: '127.0.0.1', port: ${sourcePort}, path: url.pathname + url.search }, callback);
    },
  });
};
function assertHeaders(headers) {
  if (Object.keys(headers).sort().join(',') !== 'accept,accept-encoding,user-agent') throw new Error('root7540_forwarded_header');
}
`);
  async function start({ store, enabled = true, baseline = false } = {}) {
    const data = await mkdtemp(path.join(scratch, "data-"));
    let cwd = ROOT;
    if (baseline) {
      cwd = await mkdtemp(path.join(scratch, "base-"));
      for (const entry of await readdir(ROOT)) {
        if ([".git", "server.js", "extract.mjs", "commerce-events.mjs"].includes(entry)) continue;
        await symlink(path.join(ROOT, entry), path.join(cwd, entry));
      }
      for (const entry of ["server.js", "extract.mjs", "commerce-events.mjs"]) {
        await writeFile(path.join(cwd, entry), execFileSync("git", ["show", `${BASE}:${entry}`], { cwd: ROOT }));
      }
    }
    const listener = createServer();
    const port = await listen(listener);
    await new Promise(resolve => listener.close(resolve));
    const child = spawn(process.execPath, ["--import", hook, "server.js"], {
      cwd,
      env: { PATH: process.env.PATH, PORT: String(port), NODE_OPTIONS: "--max-old-space-size=512", UV_THREADPOOL_SIZE: "1", OMP_NUM_THREADS: "1",
        COMMERCE_DATA_DIR: data, COMMERCE_INTERNAL_TOKEN: "owner-fixture-authority-".repeat(4), COMMERCE_ACTOR_SECRET: "owner-fixture-aggregate-key",
        COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000", FACILITATOR: "xpay", FACILITATOR_URL: `http://127.0.0.1:${facilitatorPort}`,
        PUBLIC_URL: "https://agents.samedaydesk.com", ...(enabled === null ? {} : { EXTRACTION_TRIAL_ENABLED: enabled ? "1" : "0" }), EXTRACTION_TRIAL_STORE: store || "", MPP_SECRET_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-40000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-40000); });
    const merchant = {
      child, data, base: `http://127.0.0.1:${port}`,
      async stop(signal = "SIGTERM") {
        if (!merchants.has(merchant)) return;
        if (child.exitCode === null && child.signalCode === null) {
          const exit = once(child, "exit"); child.kill(signal); await exit;
        }
        merchants.delete(merchant);
        if (signal === "SIGTERM") assert.equal(child.exitCode, 0, output);
        assert.doesNotMatch(output, /root7540_forbidden_fetch|root7540_forwarded_header|uncaught|unhandled/i);
      },
      async request(target, { body, raw, headers = {}, method = "GET" } = {}) {
        return new Promise((resolve, reject) => {
          const req = httpRequest({ hostname: "127.0.0.1", port, path: target, method,
            headers: { "user-agent": "CallerFixture/1", "x-forwarded-proto": "https", host: "agents.samedaydesk.com", ...((body || raw) ? { "content-type": "application/json" } : {}), ...headers },
          }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () => {
              const text = Buffer.concat(chunks).toString();
              let json; try { json = JSON.parse(text); } catch { /* HTML/empty */ }
              resolve({ status: response.statusCode, headers: response.headers, text, json });
            });
          });
          req.on("error", reject); req.end(body ? JSON.stringify(body) : raw || undefined);
        });
      },
    };
    merchants.add(merchant);
    await waitFor(() => {
      if (child.exitCode !== null) throw new Error(`merchant startup ${child.exitCode}: ${output}`);
      return output.includes(`listening on :${port}`) && output.includes("MCP server:");
    }, "merchant startup", 15000);
    return merchant;
  }
  t.after(async () => {
    for (const merchant of merchants) await merchant.stop();
    source.closeAllConnections(); facilitator.closeAllConnections();
    await new Promise(resolve => source.close(resolve));
    await new Promise(resolve => facilitator.close(resolve));
    await rm(scratch, { recursive: true, force: true });
  });
  return {
    scratch, calls, sourceCalls, start,
    url: (target = "/caller-chosen") => `http://caller.example:${sourcePort}${target}`,
    async store(value = authority()) {
      const parent = await mkdtemp(path.join(scratch, "budget-"));
      const dir = path.join(parent, "authority"); await provisionExtractionTrial(dir, value); return dir;
    },
    block() { let release; gate = new Promise(resolve => { release = resolve; }); return () => { release(); gate = null; }; },
    async events(merchant) {
      await merchant.request("/v0/commerce-demand.json"); // existing snapshot drains the owning queue
      return (await readFile(path.join(merchant.data, "commerce-events.ndjson"), "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    },
  };
}
