import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";

const route = "/integrations/vibes/agent-discoverability-audit";
const network = "eip155:8453";
const payTo = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const ticket = "synthetic.header.payload.signature";
const body = { origin: "https://seller.example", intent: "extract website metadata", route: "/extract" };
const sha256 = value => createHash("sha256").update(value).digest("hex");
function differences(left, right, prefix = "$") {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return [prefix];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => differences(left[key], right[key], `${prefix}.${key}`));
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const listen = async server => {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
};

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "merchant-independent-recovery-"));
  const calls = [];
  const stops = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const input = raw ? JSON.parse(raw) : null;
    calls.push({ path: req.url, method: req.method, headers: req.headers, input });
    let output;
    if (req.url === "/supported") output = {
      kinds: [{ x402Version: 2, scheme: "exact", network },
        { x402Version: 2, scheme: "exact", network: "eip155:84532" },
        { x402Version: 1, scheme: "exact", network: "base" }], extensions: [], signers: {},
    };
    else if (req.url.endsWith("/verify-call-ticket")) output = { ok: true,
      endpoint_slug: "samedaydesk-discoverability-audit", amount_cents: 50,
      request_body_sha256: input.request_body_sha256, charge_id: "synthetic-charge", status: "settled" };
    else if (req.url.endsWith("/delivery-receipt")) output = { ok: true, status: input.status };
    else if (req.url === "/verify") output = { isValid: false, invalidReason: "synthetic_refusal" };
    else if (req.url === "/catalog") output = { data: [], services: [], resources: [], results: [], items: [] };
    else { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(output));
  });
  const fixture = await listen(server);
  t.after(async () => {
    for (const stop of stops) await stop();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, calls, fixture, stops };
}

async function merchant(t, fixture, settings = {}) {
  const reservation = createServer(); const base = await listen(reservation);
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const dataDir = path.join(fixture.dir, "state");
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["--max-old-space-size=384", "--import", "./test/independent-recovery-preload.mjs", "server.js"], {
    cwd: import.meta.dirname,
    env: { PATH: process.env.PATH, NODE_ENV: "test", PORT: String(port),
      PUBLIC_URL: "https://agents.samedaydesk.com", PAY_TO: payTo, NETWORK: network,
      COMMERCE_DATA_DIR: dataDir, COMMERCE_ACTOR_SECRET: "synthetic-actor-generation-32-bytes",
      COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000", MPP_SECRET_KEY: "",
      CIRCLE_GATEWAY_FACILITATOR_URL: fixture.fixture,
      RECOVERY_FIXTURE_URL: fixture.fixture, RECOVERY_PROBE_ENABLED: "1",
      RECOVERY_CLOCK_MS: "1800000000000", ...settings },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  const collect = chunk => { output = (output + chunk).slice(-24000); };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 3000);
    await exited; clearTimeout(timer);
  };
  fixture.stops.push(stop);
  const deadline = Date.now() + 15000;
  while (!output.includes("POST /mcp (")) {
    if (child.exitCode !== null) return { base, dataDir, child, output, stop, refused: true };
    if (Date.now() > deadline) throw Error(`startup timeout: ${output}`);
    await wait(20);
  }
  const probe = async command => {
    const response = once(child, "message"); child.send({ probe: command });
    return (await response)[0].events;
  };
  return { base, dataDir, child, stop, probe, output, refused: false };
}

async function challenge(app) {
  const response = await fetch(`${app.base}/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1`);
  assert.equal(response.status, 402);
  const required = JSON.parse(Buffer.from(response.headers.get("payment-required"), "base64"));
  await response.text(); return required;
}
async function files(dir) {
  const result = {};
  for (const item of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) Object.assign(result, await files(target));
    else result[target] = sha256(await readFile(target));
  }
  return result;
}

for (const key of [undefined, "synthetic-unused-key"]) {
  test(`disabled mounted channel refuses before outbound and durable attempts (${key ? "key supplied" : "no key"})`, { timeout: 30000 }, async t => {
    const fixture = await setup(t);
    const app = await merchant(t, fixture, { VIBES_CODED_ENABLED: "false", ...(key ? { VIBES_CODED_API_KEY: key } : {}) });
    assert.equal(app.refused, false);
    await challenge(app); await wait(150);
    await app.probe("reset");
    const calibration = await app.probe("calibrate");
    assert.ok(calibration.some(event => event.kind === "write"));
    assert.ok(calibration.some(event => event.kind === "fetch"));
    const before = await files(app.dataDir);
    fixture.calls.length = 0; await app.probe("reset");
    for (const [method, payload, suppliedTicket, suffix, upperCase] of [
      ["HEAD"], ["POST", body, ticket], ["POST", {}, ticket],
      ["POST", "{", ticket], ["POST", body], ["POST", body, "bad"],
      ["POST", body, ticket, "/"], ["GET"], ["OPTIONS"],
      ["POST", body, ticket, "", true],
    ]) {
      const response = await fetch(`${app.base}${upperCase ? route.toUpperCase() : route}${suffix || ""}`, { method,
        headers: { "content-type": "application/json", ...(suppliedTicket ? { "x-vibes-call-ticket": suppliedTicket } : {}),
          origin: "https://synthetic-caller.example", "access-control-request-method": "POST",
          "payment-signature": "malformed", "X-SameDayDesk-Agent-Source": "agent-skills-v1" },
        ...(payload === undefined ? {} : { body: typeof payload === "string" ? payload : JSON.stringify(payload) }) });
      assert.equal(response.status, 503, `${method} disabled refusal`);
      if (method !== "HEAD") assert.deepEqual(await response.json(), { ok: false, error: "vibes_channel_disabled", charged: false });
    }
    await wait(150);
    assert.deepEqual(await app.probe("snapshot"), [], "zero outbound or durable-write attempts");
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(await files(app.dataDir), before, "retained state is byte-identical");
    const health = await fetch(`${app.base}/healthz`).then(r => r.json());
    assert.deepEqual(health.channels.vibesCoded, { enabled: false, path: route, reason: "disabled_by_configuration" });
    assert.equal(health.paymentProtocols.x402.enabled, true);
    for (const surface of ["/api/actions", "/openapi.json", "/.well-known/x402"]) {
      const response = await fetch(app.base + surface); assert.equal(response.status, 200);
      assert.equal((await response.text()).includes(route), false);
    }
    assert.equal(fixture.calls.some(c => c.path.includes("verify") || c.path.includes("receipt") || c.path.includes("settle")), false);
  });
}

test("disabled-to-enabled restart preserves state and receives the real verification/product/receipt contract", { timeout: 45000 }, async t => {
  const fixture = await setup(t);
  const disabled = await merchant(t, fixture, { VIBES_CODED_ENABLED: "0" });
  const surfaces = ["/api/actions", "/openapi.json", "/.well-known/x402"];
  const beforeSurfaces = [];
  for (const surface of surfaces) beforeSurfaces.push(await fetch(disabled.base + surface).then(r => r.text()));
  const beforeHtml = await fetch(disabled.base + "/", { headers: { accept: "text/html" } }).then(r => r.text());
  const refusal = await fetch(disabled.base + route, { method: "POST", headers: { "content-type": "application/json", "x-vibes-call-ticket": ticket }, body: JSON.stringify(body) });
  assert.equal(refusal.status, 503); await refusal.text(); await disabled.stop();
  const retained = path.join(disabled.dataDir, "retained-obligation.fixture");
  await writeFile(retained, "synthetic retained old terms; do not rewrite\n");
  const enabled = await merchant(t, fixture); // unset retains legacy enabled behavior, no key
  const head = await fetch(enabled.base + route, { method: "HEAD" }); assert.equal(head.status, 200);
  const health = await fetch(enabled.base + "/healthz").then(r => r.json());
  assert.equal(health.channels.vibesCoded.enabled, true);
  for (const [index, surface] of surfaces.entries()) {
    assert.deepEqual(differences(await fetch(enabled.base + surface).then(r => r.json()), JSON.parse(beforeSurfaces[index])), []);
  }
  assert.equal(sha256(await fetch(enabled.base + "/", { headers: { accept: "text/html" } }).then(r => r.text())), sha256(beforeHtml));
  fixture.calls.length = 0;
  const post = (payload, callTicket = ticket) => fetch(enabled.base + route, { method: "POST", headers: { "content-type": "application/json", "x-vibes-call-ticket": callTicket }, body: JSON.stringify(payload) });
  const delivered = await post(body); assert.equal(delivered.status, 200);
  const output = await delivered.json();
  assert.equal(output.channel.deliveryReceipt, "confirmed");
  assert.equal(output.channel.requestBodySha256, sha256(JSON.stringify(body)));
  assert.equal(output.channel.chargeId, "synthetic-charge");
  const receipts = fixture.calls.filter(c => c.path.endsWith("/delivery-receipt"));
  assert.equal(receipts.length, 1); assert.equal(receipts[0].input.status, "delivered");
  assert.equal(receipts[0].headers["x-api-key"], undefined);
  const { channel, ...product } = output;
  assert.equal(receipts[0].input.response_sha256, sha256(JSON.stringify(product)));
  const callCount = fixture.calls.length;
  assert.equal((await (await post(body)).json()).channel.replay, true);
  assert.equal(fixture.calls.length, callCount);
  const malformed = await post({}, ticket + "invalid-input"); assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).channel.deliveryReceipt, "failed");
  assert.equal(fixture.calls.at(-1).input.status, "failed");
  assert.equal(await readFile(retained, "utf8"), "synthetic retained old terms; do not rewrite\n");
  assert.equal(fixture.calls.some(c => c.path === "/settle"), false);
});

test("normal default xpay SDK loads supported kinds without CDP auth and keeps exact mainnet requirements", { timeout: 30000 }, async t => {
  const fixture = await setup(t);
  const app = await merchant(t, fixture, { VIBES_CODED_ENABLED: "false" });
  const required = await challenge(app);
  const offer = required.accepts.find(item => item.network === network);
  assert.equal(offer.scheme, "exact"); assert.equal(offer.amount, "50000");
  assert.equal(offer.payTo, payTo);
  assert.equal(offer.asset.toLowerCase(), "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.equal(required.accepts.some(item => item.network === "eip155:84532"), false);
  assert.equal(required.resource.url, `${app.base}/work/opportunity-preflight?rewardUsd=10&hours=1&hourlyCostUsd=1`);
  const health = await fetch(app.base + "/healthz").then(r => r.json());
  assert.equal(health.facilitator, "xpay"); assert.equal(health.facilitatorUrl, "https://facilitator.xpay.sh");
  const supported = fixture.calls.filter(c => c.path === "/supported");
  assert.ok(supported.length > 0);
  assert.ok(supported.every(c => c.method === "GET" && !c.headers.authorization && !c.headers["x-api-key"]));
  assert.equal(fixture.calls.some(c => c.path === "/verify" || c.path === "/settle"), false);
});

test("configured xpay override uses the SDK verification refusal without settlement or authority fallback", { timeout: 30000 }, async t => {
  const fixture = await setup(t);
  const app = await merchant(t, fixture, { FACILITATOR: "XPAY", FACILITATOR_URL: fixture.fixture, VIBES_CODED_ENABLED: "false" });
  const required = await challenge(app);
  const accepted = required.accepts.find(item => item.network === network);
  const payment = { x402Version: 2, resource: required.resource, accepted,
    payload: { signature: "0x" + "4".repeat(130), authorization: {
      from: "0x" + "a".repeat(40), to: accepted.payTo, value: accepted.amount,
      validAfter: "0", validBefore: "1900000000", nonce: "0x" + "5".repeat(64),
    } },
  };
  const response = await fetch(required.resource.url, {
    headers: { "payment-signature": Buffer.from(JSON.stringify(payment)).toString("base64") },
  });
  assert.equal(response.status, 402); await response.text();
  const verification = fixture.calls.filter(call => call.path === "/verify");
  assert.equal(verification.length, 1);
  assert.deepEqual(verification[0].input.paymentRequirements, accepted);
  assert.equal(verification[0].input.paymentPayload.resource.url, required.resource.url);
  assert.equal(verification[0].headers.authorization, undefined);
  assert.equal(fixture.calls.some(call => call.path === "/settle"), false);
  const health = await fetch(app.base + "/healthz").then(r => r.json());
  assert.equal(health.facilitator, "xpay"); assert.equal(health.facilitatorUrl, fixture.fixture);
});

for (const settings of [{ VIBES_CODED_ENABLED: "flase" }, { VIBES_CODED_ENABLED: "" }, { FACILITATOR: "xpaay" }, { FACILITATOR: "cdp" }]) {
  test(`malformed or unavailable authority refuses startup: ${JSON.stringify(settings)}`, { timeout: 25000 }, async t => {
    const fixture = await setup(t); const app = await merchant(t, fixture, settings);
    assert.equal(app.refused, true); assert.notEqual(app.child.exitCode, 0);
    assert.match(app.output, settings.FACILITATOR === "cdp" ? /requires CDP_API_KEY_ID/ : settings.FACILITATOR ? /Unsupported FACILITATOR/ : /VIBES_CODED_ENABLED must be/);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(await files(app.dataDir), {});
  });
}
