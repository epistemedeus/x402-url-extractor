import assert from "node:assert/strict";
import http from "node:http";
import http2 from "node:http2";
import { readFileSync } from "node:fs";
import test from "node:test";
import axios from "axios";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function allowLookup(hostname) {
  if (hostname !== "merchant-loopback.test") {
    const error = new Error("unexpected host");
    error.code = "ENOTFOUND";
    throw error;
  }
  return "127.0.0.1";
}

async function denyLookup() {
  const error = new Error("synthetic lookup refusal");
  error.code = "EPOLICY";
  throw error;
}

test("installed axios is the patched 1.20.0 pin, separate from HTTP/2 applicability", () => {
  const version = JSON.parse(readFileSync(new URL("../../node_modules/axios/package.json", import.meta.url), "utf8")).version;
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const cdp = readFileSync(new URL("../../node_modules/@coinbase/cdp-sdk/src/openapi-client/cdpApiClient.ts", import.meta.url), "utf8");
  assert.equal(version, "1.20.0");
  assert.equal(pkg.overrides.axios, "1.20.0");
  assert.equal(pkg.overrides.qs, "6.16.0");
  assert.equal(cdp.includes("httpVersion"), false);
  assert.match(cdp, /Axios\.create\(\{\s*baseURL,/);
});

test("axios 1.20.0 honors a rejecting lookup on loopback HTTP/2 and HTTP/1", async () => {
  let http2Hits = 0;
  let http1Hits = 0;
  const h2 = http2.createServer((_req, res) => {
    http2Hits += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("h2-origin");
  });
  const h1 = http.createServer((_req, res) => {
    http1Hits += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("h1-origin");
  });
  const h2Port = await listen(h2);
  const h1Port = await listen(h1);
  try {
    const allowed = await axios.get(`http://merchant-loopback.test:${h2Port}/probe`, {
      httpVersion: 2,
      lookup: allowLookup,
      timeout: 4000,
      responseType: "text",
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.data, "h2-origin");
    assert.equal(http2Hits, 1);

    await assert.rejects(axios.get(`http://merchant-loopback.test:${h2Port}/probe`, {
      httpVersion: 2,
      lookup: denyLookup,
      timeout: 4000,
    }));
    assert.equal(http2Hits, 1);

    await assert.rejects(axios.get(`http://merchant-loopback.test:${h1Port}/probe`, {
      httpVersion: 1,
      lookup: denyLookup,
      timeout: 4000,
    }));
    assert.equal(http1Hits, 0);
  } finally {
    await Promise.all([close(h2), close(h1)]);
  }
});
