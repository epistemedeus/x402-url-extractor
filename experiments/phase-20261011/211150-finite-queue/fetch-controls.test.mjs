import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOARDS, fetchAcxiom, fetchAshby, gateRequest } from './acquired/recipes/careers-board/boards.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const fetchedAt = '2026-10-13T00:10:00.000Z';
const ctx = reader => ({ boardUrl: BOARDS[reader].boardUrl, source: BOARDS[reader].endpoint, fetchedAt });

test('unchanged stdout CLI stays offline within six requests and four Acxiom pages', () => {
  const r = spawnSync(process.execPath, ['--import', resolve(here, 'network-tripwire.mjs'), '--import', resolve(here, 'offline-cli-fixtures.mjs'), resolve(here, 'acquired/recipes/careers-board/boards.mjs'), '--stdout'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr); const h = JSON.parse(r.stdout);
  assert.equal(h.acxiom.rows.length, 80); assert.equal(h.acxiom.coverage.status, 'partial');
  assert.equal(h.acxiom.coverage.remaining, 20); assert.equal(h.acxiom.coverage.pagesRead, 4);
  assert.equal(h.acxiom.coverage.maxPages, 4);
  assert.equal(h.acxiom.coverage.requests.length + h.liverampAshby.coverage.requests.length + h.liverampWorkday.coverage.requests.length, 6);
  assert.equal(h.liverampAshby.coverage.status, 'complete_for_returned_listed_set');
  assert.equal(h.liverampWorkday.coverage.status, 'source_failure'); assert.equal(h.liverampWorkday.coverage.emptyBoard, false);
  assert.equal(h.cashSpent, 0); assert.equal(h.roleFilter, null);
});
test('network tripwire independently refuses native fetch and socket escape', () => {
  const r = spawnSync(process.execPath, ['--import', resolve(here, 'network-tripwire.mjs'), '--input-type=module', '-e', `import assert from 'node:assert/strict'; import net from 'node:net'; assert.throws(() => fetch('https://api.ashbyhq.com/'), /offline_network_tripwire/); assert.throws(() => net.connect(443, 'api.ashbyhq.com'), /offline_network_tripwire/);`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 0, r.stderr);
});
test('redirect response is not followed and is unavailable rather than empty', async () => {
  let calls = 0;
  const r = await fetchAshby(ctx('liverampAshby'), { fetchImpl: async (_, init) => {
    calls++; assert.equal(init.redirect, 'manual');
    return new Response('', { status: 302, headers: { location: 'https://evil.example/' } });
  } });
  assert.equal(calls, 1); assert.equal(r.coverage.httpStatus, 302); assert.equal(r.coverage.status, 'source_failure'); assert.equal(r.coverage.emptyBoard, false);
  assert.equal(gateRequest('https://evil.example/').ok, false);
});
test('default one-million-byte response cap rejects streamed oversize before parsing', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1000001)); }, cancel() { cancelled = true; } }));
  const r = await fetchAshby(ctx('liverampAshby'), { fetchImpl: async () => response });
  assert.equal(r.coverage.requests[0].error, 'response_too_large'); assert.equal(r.coverage.requests[0].bytes, 1000001);
  assert.equal(r.coverage.status, 'wrong_schema'); assert.equal(r.coverage.emptyBoard, false); assert.equal(cancelled, true);
});
test('UTF-8 bytes rather than character counts enforce a stricter supplied cap', async () => {
  const body = JSON.stringify({ jobs: [{ title: 'Data ééé', isListed: true, location: 'Remote US', jobUrl: 'https://jobs.ashbyhq.com/liveramp-inc/a' }] });
  const r = await fetchAshby(ctx('liverampAshby'), { maxBytes: body.length, fetchImpl: async () => new Response(body) });
  assert.equal(r.coverage.requests[0].error, 'response_too_large');
});
test('stalled response body is cancelled within a shortened timeout, never raised above 15 seconds', async () => {
  let cancelled = false;
  const r = await fetchAshby(ctx('liverampAshby'), { timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } })) });
  assert.equal(r.coverage.requests[0].error, 'timeout'); assert.equal(r.coverage.status, 'source_failure');
  assert.equal(r.coverage.emptyBoard, false); assert.equal(cancelled, true);
});
test('malformed JSON response keeps wrong_schema distinct from empty', async () => {
  const r = await fetchAshby(ctx('liverampAshby'), { fetchImpl: async () => new Response('{malformed') });
  assert.equal(r.coverage.status, 'wrong_schema'); assert.equal(r.coverage.emptyBoard, false);
});
test('later failed page preserves earlier useful rows within default page bounds', async () => {
  let calls = 0;
  const r = await fetchAcxiom(ctx('acxiom'), { fetchImpl: async (_, options) => {
    calls++; assert.equal(options.redirect, 'manual');
    if (calls === 1) return new Response(JSON.stringify({ total: 2, jobPostings: [{ title: 'Data One', locationsText: 'Remote US', externalPath: '/job/Synthetic/One' }] }));
    return new Response(JSON.stringify({ errorCode: 'SYNTHETIC-FAULT' }), { status: 503 });
  } });
  assert.equal(calls, 2); assert.equal(r.rows.length, 1); assert.equal(r.coverage.status, 'partial'); assert.equal(r.coverage.remaining, 1); assert.equal(r.coverage.maxPages, 4);
});
test('repeated page stops without treating unread unique totals as complete', async () => {
  let calls = 0;
  const body = { total: 3, jobPostings: [{ title: 'Data One', externalPath: '/job/Synthetic/One', locationsText: 'Remote US' }] };
  const r = await fetchAcxiom(ctx('acxiom'), { fetchImpl: async () => { calls++; return new Response(JSON.stringify(body)); } });
  assert.equal(calls, 2); assert.equal(r.coverage.status, 'partial'); assert.equal(r.rows.length, 1); assert.equal(r.coverage.pastEnd.confirmed, true); assert.equal(r.coverage.remaining, 2);
});
