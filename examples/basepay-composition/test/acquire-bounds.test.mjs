import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireUpstream, downloadRaw, UPSTREAM_ARTIFACTS } from "../src/acquire.mjs";

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test("default downloader accepts exact chunked bytes and rejects oversized or truncated bodies", async t => {
  const url = await fixture(t, (req, res) => {
    if (req.url === "/declared") {
      res.writeHead(200, { "content-length": "1000000" }); res.flushHeaders();
    } else {
      res.writeHead(200); res.write("123");
      res.end(req.url === "/over" ? "456" : req.url === "/short" ? "" : "45");
    }
  });
  assert.equal((await downloadRaw(url, { bytes: 5 })).toString(), "12345");
  for (const path of ["/declared", "/over", "/short"]) {
    await assert.rejects(downloadRaw(url + path, { bytes: 5 }), /size|pin/);
  }
});

test("deadline covers both response headers and a stalled response body", async t => {
  const url = await fixture(t, (req, res) => {
    if (req.url === "/body") { res.writeHead(200); res.write("1"); }
  });
  for (const path of ["/headers", "/body"]) {
    const started = Date.now();
    await assert.rejects(downloadRaw(url + path, { bytes: 5 }, { timeoutMs: 100 }), /deadline/);
    assert.ok(Date.now() - started < 2000);
  }
});

test("default downloader refuses redirects without contacting their target and rejects non-200", async t => {
  let targetHits = 0;
  const target = await fixture(t, (_req, res) => { targetHits++; res.end("12345"); });
  const origin = await fixture(t, (req, res) => {
    if (req.url === "/partial") { res.writeHead(206); res.end("12345"); }
    else { res.writeHead(302, { location: target }); res.end(); }
  });
  await assert.rejects(downloadRaw(origin, { bytes: 5 }), /download failed/);
  await assert.rejects(downloadRaw(origin + "/partial", { bytes: 5 }), /HTTP 206/);
  assert.equal(targetHits, 0);
});

test("acquisition default fetch receives fixed URL and byte pin and writes nothing on overflow", async t => {
  const directory = mkdtempSync(join(tmpdir(), "s104-acquire-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let options;
  let requestedUrl;
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requestedUrl = url; options = init;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(UPSTREAM_ARTIFACTS[0].bytes + 1)); },
      cancel() { cancelled = true; },
    }));
  });
  await assert.rejects(acquireUpstream({ destDir: directory }), /exceeds pinned size/);
  assert.match(requestedUrl, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.equal(options.redirect, "error");
  assert.equal(options.signal.aborted, true);
  assert.equal(cancelled, true);
  assert.deepEqual(readdirSync(directory), []);
});
