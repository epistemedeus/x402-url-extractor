import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { jwtVerify } from "jose";
import { createCdpFacilitatorConfig, createMerchantFacilitator } from "./merchant-facilitator.mjs";

const ID = "organizations/fixture/apiKeys/fixture";
const CDP = "https://api.cdp.coinbase.com/platform/v2/x402";
const CORRELATION = "sdk_version=1.29.0,sdk_language=typescript,source=x402,source_version=2.1.0";
const operations = { verify: "POST", settle: "POST", supported: "GET" };

function testKey(alg) {
  if (alg === "ES256") {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    return { secret: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return {
    secret: Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64"),
    publicKey,
  };
}

async function checkAuthorization(authorization, publicKey, alg, uri) {
  assert.ok(authorization?.startsWith("Bearer "), "missing Bearer authorization");
  const verified = await jwtVerify(authorization.slice(7), publicKey, {
    algorithms: [alg], issuer: "cdp", subject: ID, typ: "JWT", maxTokenAge: 120,
  }).catch(() => assert.fail("synthetic CDP JWT verification failed"));
  const { payload, protectedHeader } = verified;
  assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "iss", "nbf", "sub", "uris"]);
  assert.deepEqual(Object.keys(protectedHeader).sort(), ["alg", "kid", "nonce", "typ"]);
  assert.equal(protectedHeader.kid === ID, true);
  assert.match(protectedHeader.nonce, /^[0-9a-f]{32}$/);
  assert.deepEqual(payload.uris, [uri]);
  assert.equal(payload.nbf, payload.iat);
  assert.equal(payload.exp - payload.iat, 120);
  return protectedHeader.nonce;
}

for (const alg of ["ES256", "EdDSA"]) {
  test(`CDP request JWTs for ${alg} bind each operation and are issued fresh`, async () => {
    const { secret, publicKey } = testKey(alg);
    const config = createCdpFacilitatorConfig(ID, secret);
    assert.equal(config.url, CDP);
    const nonces = new Set();
    for (const headers of [await config.createAuthHeaders(), await config.createAuthHeaders()]) {
      assert.deepEqual(headers.list, { "Correlation-Context": CORRELATION });
      for (const [operation, method] of Object.entries(operations)) {
        assert.equal(headers[operation]["Correlation-Context"], CORRELATION);
        nonces.add(await checkAuthorization(headers[operation].Authorization, publicKey, alg, `${method} ${new URL(CDP).host}${new URL(CDP).pathname}/${operation}`));
      }
    }
    assert.equal(nonces.size, 6);
  });
}

test("unknown modes, incomplete CDP configuration and invalid key formats refuse", async () => {
  assert.throws(() => createMerchantFacilitator({ FACILITATOR: "unknown" }), /Unsupported FACILITATOR/);
  assert.throws(() => createMerchantFacilitator({ FACILITATOR: "cdp", CDP_API_KEY_ID: ID }), /requires CDP_API_KEY_ID and CDP_API_KEY_SECRET/);
  const client = createMerchantFacilitator({ FACILITATOR: "cdp", CDP_API_KEY_ID: ID, CDP_API_KEY_SECRET: "invalid fixture" }).client;
  await assert.rejects(client.getSupported(), { message: "Invalid CDP API key format" });
});

test("real facilitator client sends operation-bound CDP headers and no auth in xpay or testnet", async (t) => {
  const { secret, publicKey } = testKey("EdDSA");
  const calls = [];
  const originalFetch = globalThis.fetch;
  let routeOrigin;
  let fault;
  const server = createServer(async (req, res) => {
    req.resume();
    try {
      const operation = req.url.split("/").at(-1);
      const authenticated = routeOrigin === CDP;
      if (authenticated) {
        await checkAuthorization(req.headers.authorization, publicKey, "EdDSA", `${req.method} ${new URL(CDP).host}${req.url}`);
        assert.equal(req.headers["correlation-context"], CORRELATION);
      } else {
        assert.equal(req.headers.authorization === undefined, true);
        assert.equal(req.headers["correlation-context"] === undefined, true);
      }
      calls.push([authenticated, req.method, req.url]);
      res.setHeader("Content-Type", "application/json");
      if (operation === "supported") {
        const network = req.url === "/facilitator/supported" ? "eip155:84532" : "eip155:8453";
        res.end(JSON.stringify({ kinds: [{ x402Version: 2, network, scheme: "exact" }], extensions: [], signers: {} }));
      }
      else if (operation === "verify") res.end(JSON.stringify({ isValid: false }));
      else res.end(JSON.stringify({ success: false, transaction: "", network: "eip155:8453" }));
    } catch (error) {
      fault = error;
      res.writeHead(400).end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    globalThis.fetch = originalFetch;
    return new Promise((done) => server.close(done));
  });
  globalThis.fetch = (input, init) => {
    const url = new URL(input);
    assert.ok(url.href.startsWith(`${routeOrigin}/`), "unexpected facilitator destination");
    return originalFetch(`http://127.0.0.1:${server.address().port}${url.pathname}`, init);
  };
  const fixture = { CDP_API_KEY_ID: ID, CDP_API_KEY_SECRET: secret };
  for (const [env, url, mode] of [
    [fixture, "https://facilitator.xpay.sh", "xpay"],
    [{ ...fixture, FACILITATOR: "testnet" }, "https://x402.org/facilitator", "testnet"],
    [{ ...fixture, FACILITATOR: "cdp", FACILITATOR_URL: "https://wrong.invalid" }, CDP, "cdp"],
  ]) {
    const config = createMerchantFacilitator(env);
    assert.equal(config.mode, mode);
    assert.equal(config.client.url, url);
    routeOrigin = url;
    const supported = await config.client.getSupported();
    assert.equal(supported.kinds[0].network, mode === "testnet" ? "eip155:84532" : "eip155:8453");
    if (mode !== "cdp") continue;
    // Loopback records the authenticated HTTP operations and always refuses them.
    assert.equal((await config.client.verify({ x402Version: 2 }, {})).isValid, false);
    assert.equal((await config.client.settle({ x402Version: 2 }, {})).success, false);
  }
  if (fault) throw fault;
  assert.deepEqual(calls, [
    [false, "GET", "/supported"],
    [false, "GET", "/facilitator/supported"],
    [true, "GET", "/platform/v2/x402/supported"],
    [true, "POST", "/platform/v2/x402/verify"],
    [true, "POST", "/platform/v2/x402/settle"],
  ]);
});
