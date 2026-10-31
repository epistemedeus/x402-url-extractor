import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { AIAX_MANIFEST_PATHS, AIAX_SECTION_PATH, AIAX_MAX_BYTES, buildAiaxDiscovery } from "./projection.mjs";
import { EXTRACT_MAX_BODY_BYTES, EXTRACT_TIMEOUT_MS, EXTRACT_TEXT_EXCERPT_CHARS, EXTRACT_TEXT_EXCERPT_MAX_CHARS } from "../extract-capture.mjs";
import { omitFreePageCompareLlmsSection } from "../page-change-free-surface.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://agents.samedaydesk.com";
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
const schemas = {};
const validators = {};
for (const kind of ["manifest", "section"]) {
  schemas[kind] = JSON.parse(await readFile(new URL(`./fixtures/${kind}.schema.json`, import.meta.url)));
  validators[kind] = ajv.compile(schemas[kind]);
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function snapshot(dir) {
  const files = {};
  async function walk(at, prefix = "") {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const name = path.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(at, entry.name), name);
      else if (name !== "commerce-events.ndjson") files[name] = hash(await readFile(path.join(at, entry.name)));
    }
  }
  await walk(dir);
  return files;
}
function send(port, target, method = "GET", headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: target, method,
      headers: { accept: "application/json", "user-agent": "ROOT7290 offline fixture", ...headers } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}
async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

// Mirrors resolve unchanged dependencies through symlinks. Only server.js is
// copied. No second Git checkout/writer and no mutation of the admitted source.
async function mirror(dir, baseline) {
  for (const entry of await readdir(root)) {
    if ([".git", "server.js", "aiax-discovery"].includes(entry)) continue;
    await symlink(path.join(root, entry), path.join(dir, entry));
  }
  const source = baseline
    ? execFileSync("git", ["show", "e291d41c1f1763e638e2812568290ed176a31c49:server.js"], { cwd: root })
    : await readFile(path.join(root, "server.js"));
  await writeFile(path.join(dir, "server.js"), source);
}

test("offline actual merchant AIAX projection and removal preserve owning consumers", { timeout: 60000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), "root7290-aiax-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const calls = [];
  const facilitator = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.writeHead(req.url === "/supported" ? 200 : 500, { "content-type": "application/json" });
    res.end(JSON.stringify({ kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} }));
  });
  facilitator.listen(0, "127.0.0.1");
  await once(facilitator, "listening");
  t.after(() => new Promise(resolve => facilitator.close(resolve)));
  const hook = path.join(scratch, "guard.mjs");
  await writeFile(hook, `import { Server } from 'node:net';
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-10-25T06:16:30Z'])); }
      static now() { return RealDate.parse('2026-10-25T06:16:30Z'); }
    };
    const listen = Server.prototype.listen;
    Server.prototype.listen = function(port, ...args) { return listen.call(this, port, '127.0.0.1', ...args); };
    const fetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (u.hostname !== '127.0.0.1' || u.pathname !== '/supported') {
        console.error('ROOT7290 forbidden fetch', u.origin, u.pathname);
        throw new Error('ROOT7290 forbidden fetch');
      }
      return fetch(input, init);
    };
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = () => { console.error('ROOT7290 extraction reached'); throw new Error('ROOT7290 extraction reached'); };`);
  async function run({ cwd = root, price = "$0.005", inspect }) {
    const data = await mkdtemp(path.join(scratch, "data-"));
    const port = await unusedPort();
    const child = spawn(process.execPath, ["--import", hook, "server.js"], {
      cwd,
      env: { PATH: process.env.PATH, HOME: data, PORT: String(port),
        NODE_OPTIONS: "--max-old-space-size=512", UV_THREADPOOL_SIZE: "1", OMP_NUM_THREADS: "1",
        COMMERCE_DATA_DIR: data, COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
        FACILITATOR: "xpay", FACILITATOR_URL: `http://127.0.0.1:${facilitator.address().port}`,
        PUBLIC_URL: origin, MPP_SECRET_KEY: "", EXTRACT_PRICE: price },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`startup timeout: ${output}`)), 15000);
        const collect = chunk => {
          output = (output + chunk).slice(-40000);
          if (output.includes(`listening on :${port}`) && output.includes("MCP server:")) { clearTimeout(timer); resolve(); }
        };
        child.stdout.on("data", collect); child.stderr.on("data", collect);
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`startup ${code}: ${output}`)); });
      });
      await inspect(port, data);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
      }
      assert.doesNotMatch(output, /ROOT7290 forbidden fetch|ROOT7290 extraction reached|AIAX discovery adapter not mounted/);
    }
  }
  const consumerPaths = ["/openapi.json", "/mpp-openapi.json", "/.well-known/x402", "/api/actions", "/llms.txt", "/skill.md"];
  async function consumers(port) {
    const found = {};
    for (const p of consumerPaths) {
      const response = await send(port, p);
      assert.equal(response.status, 200, p);
      found[p] = { body: response.body, type: response.headers["content-type"] };
    }
    const html = await send(port, "/", "GET", { accept: "text/html" });
    assert.equal(html.status, 200);
    found["HTML /"] = { body: html.body, type: html.headers["content-type"] };
    for (const target of ["/platforms", "/platforms/methodology", "/alerts"]) {
      const response = await send(port, target, "GET", { accept: "text/html" });
      assert.equal(response.status, 200, target);
      found[`HTML ${target}`] = { body: response.body, type: response.headers["content-type"] };
    }
    const invalid = await send(port, "/extract?url=invalid");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers["payment-required"], undefined);
    found["invalid extract"] = { body: invalid.body, type: invalid.headers["content-type"] };
    return found;
  }
  let retained;
  let docs;
  let defaultTag;
  await run({ inspect: async (port, data) => {
    await t.test("GET aliases, HEAD and conditional cache stay free, bounded and effect-free", async () => {
      const filesBefore = await snapshot(data);
      const callsBefore = calls.length;
      const fetched = {};
      for (const target of [...AIAX_MANIFEST_PATHS, AIAX_SECTION_PATH]) {
        const response = await send(port, target);
        assert.equal(response.status, 200);
        assert.match(response.headers["content-type"], /^application\/json/);
        assert.equal(response.headers["cache-control"], "public, max-age=300");
        assert.ok(response.headers.etag);
        for (const header of ["payment-required", "payment-response", "www-authenticate", "set-cookie"]) assert.equal(response.headers[header], undefined);
        const kind = target === AIAX_SECTION_PATH ? "section" : "manifest";
        assert.ok(Buffer.byteLength(response.body) <= AIAX_MAX_BYTES[kind]);
        const value = JSON.parse(response.body);
        assert.equal(validators[kind](value), true, JSON.stringify(validators[kind].errors));
        fetched[target] = response;
        const head = await send(port, target, "HEAD");
        assert.equal(head.status, 200);
        assert.equal(head.body, "");
        assert.equal(head.headers.etag, response.headers.etag);
        assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(response.body));
        for (const method of ["GET", "HEAD"]) {
          const cached = await send(port, target, method, { "if-none-match": response.headers.etag });
          assert.equal(cached.status, 304); assert.equal(cached.body, "");
        }
        const injected = await send(port, `${target}?url=https://never-fetch.invalid`, "GET", { host: "evil.invalid", "x-forwarded-host": "evil.invalid" });
        assert.equal(injected.body, response.body);
      }
      assert.equal(fetched[AIAX_MANIFEST_PATHS[0]].body, fetched[AIAX_MANIFEST_PATHS[1]].body);
      assert.deepEqual(await snapshot(data), filesBefore, "discovery changes no state except normal request telemetry");
      const events = (await readFile(path.join(data, "commerce-events.ndjson"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
      assert.ok(events.every(event => event.kind === "unmatched"), "new routes retain existing unmatched telemetry classification");
      assert.ok(events.every(event => !event.paymentPresent && !event.settlement), "no paid or settlement event");
      assert.deepEqual(calls.slice(callsBefore), [], "discovery makes no facilitator call");
      docs = { manifest: JSON.parse(fetched[AIAX_MANIFEST_PATHS[0]].body), section: JSON.parse(fetched[AIAX_SECTION_PATH].body) };
      defaultTag = fetched[AIAX_SECTION_PATH].headers.etag;
      t.diagnostic(`actual JSON bytes: manifest=${Buffer.byteLength(fetched[AIAX_MANIFEST_PATHS[0]].body)} section=${Buffer.byteLength(fetched[AIAX_SECTION_PATH].body)}`);
    });
    await t.test("matching IDs and canonical inputs, output, price and usable request", async () => {
      const { manifest, section } = docs;
      assert.equal(manifest.entry_points.length, 1);
      assert.equal(manifest.entry_points[0].id, section.section_id);
      assert.equal(manifest.entry_points[0].url, AIAX_SECTION_PATH);
      assert.equal(new URL(manifest.entry_points[0].url, origin).origin, origin);
      assert.deepEqual(manifest.trust_signals, {});
      assert.equal(manifest.product.domain, "web-data-extraction");
      assert.equal(manifest.mcp_endpoint, `${origin}/mcp`);
      assert.equal(section.mcp_tool_name, "extract");
      assert.equal(section.pact_mandate_template, null);
      assert.equal(section.latency_p50_ms, undefined);
      const openapi = JSON.parse((await send(port, "/openapi.json")).body);
      const action = JSON.parse((await send(port, "/api/actions")).body).actions.find(a => a.path === "/extract" || a.route === "/extract" || a.url === `${origin}/extract`);
      assert.ok(action, "canonical extract action");
      assert.deepEqual(section.inputs, action.request.schema.properties.queryParams);
      assert.deepEqual(section.outputs, openapi.paths["/extract"].get.responses["200"].content["application/json"].schema);
      assert.equal(section.openapi_operation_id, openapi.paths["/extract"].get.operationId);
      assert.equal(section.pricing.amount, openapi.paths["/extract"].get["x-payment-info"].price.amount);
      assert.equal(section.pricing.amount, "0.005");
      assert.equal(manifest.pricing_summary.startsWith("0.005 USDC"), true);
      const example = section.examples[0];
      assert.match(example.description, /Illustrative.*not an observed/);
      assert.equal(example.request.method, "GET");
      assert.equal(example.request.url, action.request.exampleUrl);
      assert.equal(new URL(example.request.url).searchParams.get("url"), "https://example.com");
      const challenge = await send(port, new URL(example.request.url).pathname + new URL(example.request.url).search);
      assert.equal(challenge.status, 402);
      const offer = JSON.parse(Buffer.from(challenge.headers["payment-required"], "base64"));
      assert.equal(offer.accepts[0].amount, "5000");
      assert.deepEqual(section.extensions.samedaydesk.capture_limits, {
        timeout_ms: EXTRACT_TIMEOUT_MS, max_body_bytes: EXTRACT_MAX_BODY_BYTES,
        default_excerpt_chars: EXTRACT_TEXT_EXCERPT_CHARS, max_excerpt_chars: EXTRACT_TEXT_EXCERPT_MAX_CHARS, javascript_executed: false,
      });
    });
    await t.test("malformed and unsupported sections never reach extraction or payment", async () => {
      for (const target of ["/aiax/sections/unknown.json", "/aiax/sections/%ZZ.json", "/aiax/sections/%2e%2e%2fserver.js", "/aiax/sections/extract.json/extra", "/aiax/sections/", "/aiax/sections/extract%00.json"]) {
        const response = await send(port, target);
        assert.equal(response.status, 404, target);
        assert.deepEqual(JSON.parse(response.body), { error: "aiax_section_not_found" });
        assert.equal(response.headers["payment-required"], undefined);
      }
      for (const target of [...AIAX_MANIFEST_PATHS, AIAX_SECTION_PATH]) {
        const response = await send(port, target, "POST");
        assert.equal(response.status, 405); assert.equal(response.headers.allow, "GET, HEAD");
        assert.equal(response.headers["cache-control"], "no-store");
      }
      assert.equal((await send(port, "/aiax/benchmark.json")).status, 404);
    });
    retained = await consumers(port);
  } });
  await t.test("exact schemas reject missing fields and wrong types", () => {
    for (const kind of ["manifest", "section"]) {
      for (const field of schemas[kind].required) {
        const missing = structuredClone(docs[kind]); delete missing[field];
        assert.equal(validators[kind](missing), false, `${kind}.${field} missing`);
        const wrong = structuredClone(docs[kind]); wrong[field] = false;
        assert.equal(validators[kind](wrong), false, `${kind}.${field} wrong type`);
      }
    }
    for (const amount of ["0", "1", "0.005", "0.01", "1.5"]) {
      const value = structuredClone(docs.section); value.pricing.amount = amount;
      assert.equal(validators.section(value), true);
    }
    for (const amount of ["-1", "x", "0\\.005"]) {
      const value = structuredClone(docs.section); value.pricing.amount = amount;
      assert.equal(validators.section(value), false);
    }
  });
  await t.test("canonical price override propagates without stale cache identity", async () => {
    await run({ price: "$0.007", inspect: async port => {
      const manifest = JSON.parse((await send(port, AIAX_MANIFEST_PATHS[0])).body);
      const response = await send(port, AIAX_SECTION_PATH);
      const section = JSON.parse(response.body);
      const api = JSON.parse((await send(port, "/openapi.json")).body);
      assert.equal(section.pricing.amount, "0.007");
      assert.equal(section.pricing.amount, api.paths["/extract"].get["x-payment-info"].price.amount);
      assert.equal(manifest.pricing_summary.startsWith("0.007 USDC"), true);
      assert.notEqual(response.headers.etag, defaultTag);
      assert.equal(manifest.updated_at, docs.manifest.updated_at);
    } });
  });
  for (const baseline of [false, true]) {
    await t.test(baseline ? "exact baseline preserves machine and emitted human responses" : "physical adapter removal preserves existing consumers", async () => {
      const dir = await mkdtemp(path.join(scratch, "source-"));
      await mirror(dir, baseline);
      await run({ cwd: dir, inspect: async port => {
        for (const target of [...AIAX_MANIFEST_PATHS, AIAX_SECTION_PATH]) assert.equal((await send(port, target)).status, 404);
        const found = await consumers(port);
        for (const [target, response] of Object.entries(found)) {
          assert.equal(response.type, retained[target].type, target);
          let amended = retained[target].body;
          // This admitted amendment adds only canonical trial links. Keep the
          // historical whole-document comparison after removing those links.
          if (baseline && !target.startsWith("HTML ") && target !== "invalid extract") {
            if (["/llms.txt", "/skill.md"].includes(target)) {
              amended = amended.replace(/^- Walletless extraction trial contract \(current availability, request and limits\): https:\/\/[^\n]+\n/m, "");
              if (target === "/llms.txt") amended = omitFreePageCompareLlmsSection(amended);
            } else {
              const value = JSON.parse(amended);
              if (target.includes("openapi")) delete value["x-service-info"].docs.extractionTrial;
              if (target === "/api/actions") delete value.discovery.extractionTrial;
              amended = JSON.stringify(value);
            }
          }
          assert.equal(hash(response.body), hash(amended), `${target} raw body outside admitted trial links`);
        }
      } });
    });
  }
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call === "GET /supported"), JSON.stringify(calls));
});

test("projection rejects unsupported owning contracts and bounds configuration", () => {
  const base = {
    publicUrl: origin, resource: { url: `${origin}/extract`, description: "Extract a public page." },
    request: { example: { method: "GET", queryParams: { url: "https://example.com" } }, schema: { properties: { queryParams: { type: "object", required: ["url"], properties: { url: { type: "string" } } } } } },
    output: { schema: { type: "object" }, example: { ok: true } }, amount: "0.005", operationId: "extractUrl", mcpToolName: "extract", captureLimits: {},
  };
  for (const mutate of [
    c => { c.resource.url = "https://other.invalid/extract"; },
    c => { c.resource.url = "https://user:password@agents.samedaydesk.com/extract"; },
    c => { c.resource.url += "?secret=do-not-publish"; },
    c => { c.amount = 0.005; },
    c => { c.request.example.method = "POST"; },
    c => { c.request.schema.properties.queryParams.required = []; },
    c => { c.amount = "-1"; },
    c => { c.output.schema = null; },
  ]) {
    const value = structuredClone(base); mutate(value);
    assert.throws(() => buildAiaxDiscovery(value), /Unsupported AIAX/);
  }
  assert.throws(() => buildAiaxDiscovery({ ...base, output: { ...base.output, example: { text: "x".repeat(9000) } } }), /exceeds byte limit/);
  assert.equal(buildAiaxDiscovery(base).manifest, buildAiaxDiscovery(base).manifest, "no request/restart clock");
});
