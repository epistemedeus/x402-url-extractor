import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";

// Actual server.js mounting, not an invented parameterised SDK example.
// Existing extract.http tests cover paid execution; this fixture never accepts payment.
test("actual merchant excludes upstream 3850/3852 producers for unpaid requests", { timeout: 30000 }, async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), "root2191-paywall-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const calls = [];
  const facilitator = createServer((req, res) => {
    calls.push(req.url);
    res.setHeader("content-type", "application/json");
    res.statusCode = req.url === "/supported" ? 200 : 500;
    res.end(JSON.stringify({ kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} }));
  });
  facilitator.listen(0, "127.0.0.1");
  await once(facilitator, "listening");
  t.after(() => new Promise(resolve => facilitator.close(resolve)));
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const hook = path.join(scratch, "loopback-only.mjs");
  await writeFile(hook, `const realFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.hostname !== '127.0.0.1') throw new Error('ROOT2191 blocked external fetch');
      if (url.pathname !== '/supported') throw new Error('ROOT2191 protected handler or financial request reached');
      return realFetch(input, init);
    };
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = () => { throw new Error('ROOT2191 protected extract reached'); };`);
  const child = spawn(process.execPath, ["--import", hook, "server.js"], {
    cwd: process.env.ROOT2191_MERCHANT_CWD || new URL(".", import.meta.url),
    env: { PATH: process.env.PATH, HOME: scratch, PORT: String(port),
      COMMERCE_DATA_DIR: scratch, COMMERCE_RECONCILIATION_INTERVAL_MS: "86400000",
      FACILITATOR: "xpay", FACILITATOR_URL: `http://127.0.0.1:${facilitator.address().port}`,
      PUBLIC_URL: "https://agents.samedaydesk.com", MPP_SECRET_KEY: "", EXTRACT_BATCH_ENABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, "exit"); child.kill("SIGTERM"); await ended;
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output)), 15000);
    const collect = chunk => { output += chunk; if (output.includes(`listening on :${port}`)) { clearTimeout(timer); resolve(); } };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`startup ${code}: ${output}`)); });
  });
  const send = (target, headers = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path: target, headers: { "user-agent": "Mozilla/5.0 ROOT2191 owned fixture", ...headers } }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", x => body += x);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on("error", reject); req.end();
  });
  const marker = "</script><script>globalThis.ROOT2191=1</script>";
  const cases = [
    ["normal", "/extract?url=https://fixture.invalid/", {}],
    ["encoded-query", `/extract?url=https://fixture.invalid/&probe=${encodeURIComponent(marker)}`, {}],
    ["raw-query", `/extract?url=https://fixture.invalid/&probe=${marker}`, {}],
    ["host", "/extract?url=https://fixture.invalid/", { host: `owned.invalid${marker}` }],
    ["forwarded-host", "/extract?url=https://fixture.invalid/", { "x-forwarded-host": `owned.invalid${marker}`, "x-forwarded-proto": "https" }],
    ["encoded-slash-query", "/extract?url=https://fixture.invalid/a%2Fb%5Cc", {}],
    ["trailing-slash", "/extract/?url=https://fixture.invalid/", {}],
    ["case", "/EXTRACT?url=https://fixture.invalid/", {}],
  ];
  for (const accept of [undefined, "application/json", "text/html"]) {
    for (const [label, target, headers] of cases) {
      await t.test(`${label} Accept=${accept || "default"}`, async () => {
        const response = await send(target, { ...headers, ...(accept ? { accept } : {}) });
        if (["host", "forwarded-host"].includes(label)) {
          assert.equal(response.status, 500); // Invalid authority rejected before challenge construction.
          assert.equal(response.body.includes(marker), false);
          assert.doesNotMatch(response.body, /<script[\s>]/i);
          return;
        }
        assert.equal(response.status, 402);
        assert.match(response.headers["content-type"], accept === "text/html" ? /^text\/html/ : /^application\/json/);
        const challenge = JSON.parse(Buffer.from(response.headers["payment-required"], "base64").toString());
        assert.equal(challenge.x402Version, 2);
        assert.equal(challenge.accepts[0].amount, "5000");
        if (accept === "text/html") {
          assert.equal(response.body.includes(marker), false);
          assert.doesNotMatch(response.body, /<script[\s>]/i);
        } else assert.equal(JSON.parse(response.body).x402Version, 2);
        // JSON can preserve the marker; no HTML script context is emitted.
        assert.equal(response.body.includes("window.x402"), false);
      });
    }
    for (const target of ["/%65xtract?url=https://fixture.invalid/", "/extract%2Fowned?url=https://fixture.invalid/", "/extract%5Cowned?url=https://fixture.invalid/"]) {
      const response = await send(target, accept ? { accept } : {});
      assert.equal(response.status, target.startsWith("/%65") ? 402 : 404, target);
    }
    const free = await send("/healthz", accept ? { accept } : {});
    assert.equal(free.status, 200);
    assert.equal(free.headers["payment-required"], undefined);
  }
  assert.ok(calls.length > 0);
  assert.ok(calls.every(x => x === "/supported"), JSON.stringify(calls));
  assert.doesNotMatch(output, /protected extract reached|protected handler or financial request reached/);
});
