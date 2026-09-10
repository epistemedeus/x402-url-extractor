import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { extract, readMarkdown, fetchWithGuards, assertPublicHttpUrl, readMcpOutputSchema } from './extract.mjs';
import { decodeHttpBody, EXTRACT_MAX_BODY_BYTES, resolveExtractFetch } from './extract-capture.mjs';
import { publicFetch } from './extract-batch-c1/public-fetch.mjs';
import { loadSource } from './extract-batch-c1/transport.mjs';
import { executeExtractBatch, normalizeExtractBatchInput, extractBatchMcpOutputSchema } from './extract-batch.mjs';

async function injected(fn, fetchImpl, timeout = 1000) {
  const oldFetch = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const oldTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = fetchImpl;
  globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = timeout;
  try { return await fn(); }
  finally { globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = oldFetch; globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = oldTimeout; }
}

test('default extractor uses DNS-pinned transport; private literals and credentials are rejected', async () => {
  assert.equal(resolveExtractFetch(), publicFetch);
  for (const url of ['http://127.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://100.64.0.1/', 'http://user:secret@example.com/']) {
    assert.throws(() => assertPublicHttpUrl(url));
  }
  let requests = 0;
  await assert.rejects(publicFetch('https://public.example/', {}, {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    request() { requests++; },
  }), { code: 'ssrf_blocked' });
  assert.equal(requests, 0);
});

test('validated DNS address is pinned to the actual request lookup', async () => {
  let lookups = 0;
  const res = await publicFetch('https://public.example/', {}, {
    lookup: async () => { lookups++; return [{ address: '93.184.216.34', family: 4 }]; },
    request(url, options, callback) {
      assert.equal(url.hostname, 'public.example');
      options.lookup(url.hostname, {}, (error, address) => { assert.equal(error, null); assert.equal(address, '93.184.216.34'); });
      const req = new EventEmitter();
      req.end = () => { const body = Readable.from(['ok']); body.statusCode = 200; body.headers = {}; callback(body); };
      return req;
    },
  });
  assert.equal(lookups, 1);
  assert.equal(res.status, 200);
  await res.body.cancel();
});

test('single URL redirects validate every hop, preserve identity and stop at a finite limit', async () => {
  const calls = [];
  await injected(async () => {
    const result = await extract('https://first.example/path');
    assert.equal(result.requestedUrl, 'https://first.example/path');
    assert.equal(result.finalUrl, 'https://second.example/end');
    assert.equal(result.links[0], 'https://second.example/next');
  }, async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'manual');
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://second.example/end' } }) : new Response('<a href="/next">next</a>');
  });
  assert.equal(calls.length, 2);
  for (const target of ['http://127.0.0.1/', 'http://[::1]/', 'file:///etc/passwd']) {
    let count = 0;
    await injected(() => assert.rejects(extract('https://first.example/')), async () => { count++; return new Response(null, { status: 302, headers: { location: target } }); });
    assert.equal(count, 1);
  }
  let hops = 0;
  await injected(() => assert.rejects(extract('https://first.example/'), { code: 'redirect_error' }), async () => { hops++; return new Response(null, { status: 302, headers: { location: '/again' } }); });
  assert.equal(hops, 4);
});

test('streaming body stalls and nonstreaming responses cannot evade bounds', async () => {
  await injected(() => assert.rejects(readMarkdown('https://slow.example/'), { name: 'AbortError' }), async () => ({ status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }), 20);
  let textCalls = 0;
  await injected(() => assert.rejects(extract('https://bad.example/'), { code: 'invalid_response' }), async () => ({ status: 200, headers: new Headers(), text: async () => { textCalls++; return 'unbounded'; } }));
  assert.equal(textCalls, 0);
  const batch = await loadSource('https://slow.example/', { allowLive: true, timeoutMs: 20, fetchImpl: async () => ({ status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }) });
  assert.equal(batch.code, 'timeout_or_abort');
});

test('exact byte cap is not called truncated; over-cap is cancelled and reported', async () => {
  for (const extra of [0, 1]) {
    let cancelled = false;
    await injected(async () => {
      const result = await fetchWithGuards('https://large.example/');
      assert.equal(result.bytes, EXTRACT_MAX_BODY_BYTES);
      assert.equal(result.bodyTruncated, extra === 1);
    }, async () => {
      let sent = false;
      return { status: 200, headers: new Headers(), body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { value: new Uint8Array(EXTRACT_MAX_BODY_BYTES + extra), done: false }), cancel: async () => { cancelled = true; } }) } };
    });
    assert.equal(cancelled, extra === 1);
  }
});

test('charset label names the decoder actually used and valid JSON-LD null cannot crash extraction', async () => {
  const decoded = decodeHttpBody(Uint8Array.of(0x80), { contentType: 'text/html;charset=iso-8859-1' });
  assert.equal(decoded.html, '€');
  assert.equal(decoded.charset, 'windows-1252');
  await injected(async () => { const result = await extract('https://json.example/'); assert.deepEqual(result.jsonLd, [null]); }, async () => new Response('<script type="application/ld+json">null</script><p>hello</p>'));
});

test('real disposable HTTP source refusal stays typed; null-body 204 works in read and batch', async () => {
  const server = createServer((_req, res) => { res.writeHead(403, { 'content-type': 'text/html' }); res.end('<p>Access denied</p>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await injected(async () => {
      const result = await readMarkdown('https://source.example/');
      assert.equal(readMcpOutputSchema.safeParse(result).success, true);
      assert.equal(result.ok, true); assert.equal(result.sourceOk, false); assert.equal(result.error.code, 'http_403');
      assert.match(result.markdown, /Access denied/);
    }, async (_url, init) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/`, init);
      return { status: response.status, headers: response.headers, body: response.body };
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
  await injected(async () => { const result = await readMarkdown('https://empty.example/'); assert.equal(result.status, 204); assert.equal(result.markdown, ''); }, async () => new Response(null, { status: 204 }));
  const loaded = await loadSource('https://empty.example/', { allowLive: true, fetchImpl: async () => new Response(null, { status: 204 }) });
  assert.equal(loaded.ok, true); assert.equal(loaded.httpStatus, 204); assert.equal(loaded.bytes, 0);
});

test('typed batch reports excerpt limit and partial status without claiming missing discussion is absent', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'extract-review-'));
  try {
    const input = normalizeExtractBatchInput({ urls: ['https://text.example/'], fields: ['text'] });
    const result = await executeExtractBatch({ input, rawBody: Buffer.from(JSON.stringify(input)), headers: {}, dataDir, fetchImpl: async () => new Response('<p>' + 'x'.repeat(1400) + '</p>') });
    assert.equal(extractBatchMcpOutputSchema.safeParse(result).success, true);
    const row = result.sources[0];
    assert.equal(row.data.text.length, 1200); assert.equal(row.status, 'partial'); assert.equal(row.error.code, 'text_truncated');
    assert.equal(row.provenance.capture.textTruncated, true); assert.equal(row.provenance.capture.javascriptExecuted, false);
    assert.equal(row.provenance.capture.textExcerptLimitChars, 1200); assert.equal(row.provenance.capture.bodyTruncated, false);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});


test('public read metadata avoids full-page promises and test hooks have no request binding', async () => {
  const server = await readFile(new URL('./server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /full page content as clean Markdown/);
  assert.match(server, /name: "read"[^\n]*outputSchema: readMcpOutputSchema/);
  assert.doesNotMatch(server, /__SAMEDAYDESK_EXTRACT_(FETCH|TIMEOUT_MS)__/);
});
