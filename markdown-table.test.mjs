import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { readMarkdown, readMcpOutputSchema } from './extract.mjs';
import { EXTRACT_MAX_BODY_BYTES } from './extract-capture.mjs';
import { TABLE_LIMITS } from './markdown-table.mjs';

const MATRIX = '<table><tr><th>Engine</th><th>Transpile</th><th>Reconcile</th></tr><tr><td>Alpha</td><td></td><td>Yes</td></tr><tr><td>Beta</td><td>No</td><td></td></tr></table>';
const SPANS = '<table><tr><th rowspan="2">Engine</th><th colspan="2">Support</th></tr><tr><th>Transpile</th><th>Reconcile</th></tr><tr><td rowspan="2">Alpha</td><td>Yes</td><td></td></tr><tr><td colspan="2">Preview</td></tr></table>';
const TABLE = '<table><tr><td>one</td><td>two</td></tr></table>';

async function read(html, { maxChars = 40000, status = 200, fetchImpl, timeout = 1000 } = {}) {
  const oldFetch = globalThis.__SAMEDAYDESK_EXTRACT_FETCH__;
  const oldTimeout = globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__;
  globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = timeout;
  globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = fetchImpl || (async () => new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try { return await readMarkdown('https://matrix.example/start', maxChars); }
  finally {
    globalThis.__SAMEDAYDESK_EXTRACT_FETCH__ = oldFetch;
    globalThis.__SAMEDAYDESK_EXTRACT_TIMEOUT_MS__ = oldTimeout;
  }
}

test('actual reader keeps empty middle and trailing cells under their original headers', async () => {
  const before = Date.now();
  const result = await read(MATRIX);
  assert.equal(result.markdown, MATRIX);
  assert.equal(result.wordCount, 7);
  assert.equal(result.truncated, false);
  assert.equal(result.capture.textTruncated, false);
  assert.equal(result.capture.bodyBytes, Buffer.byteLength(MATRIX));
  assert.equal(result.capture.markdownLimitChars, 40000);
  assert.equal(readMcpOutputSchema.safeParse(result).success, true);
  assert.ok(Date.parse(result.fetchedAt) >= before && Date.parse(result.fetchedAt) <= Date.now());
});

test('combined spans, multirow/row headers, caption, colgroups and row-group spans remain native', async () => {
  assert.equal((await read(SPANS)).markdown, SPANS);
  const html = '<table><caption>Support</caption><colgroup><col span="2"></colgroup><thead><tr><th id="h" scope="col">Engine</th><th>Value</th></tr></thead><tbody><tr><th rowspan="0" scope="rowgroup">A</th><td headers="h">1</td></tr><tr><td>2</td></tr></tbody><tfoot><tr><th>Total</th><td>2</td></tr></tfoot></table>';
  assert.equal((await read(html)).markdown, html);
});

test('native table escaping retains code, entity Unicode, line breaks, links and footnotes', async () => {
  const html = '<table class="matrix" onclick="bad()"><caption>A &amp; B</caption><tr><th id="c">Syntax</th><th>Notes</th></tr><tr><td headers="c"><pre><code>x &lt; y\n\n`a|b` &#x1f600;</code></pre></td><td><a href="../guide?q=a&amp;b=c">Guide</a><sup><a href="#fn1">1</a></sup><br><span id="fn1">Preview &copy;</span></td></tr></table>';
  const result = await read(html);
  assert.equal(result.truncated, false);
  assert.match(result.markdown, /<code>x &lt; y&#10;&#10;&#96;a&#124;b&#96; 😀<\/code>/);
  assert.match(result.markdown, /href="https:\/\/matrix.example\/guide\?q=a&amp;b=c"/);
  assert.match(result.markdown, /<sup><a href="https:\/\/matrix.example\/start#fn1">1<\/a><\/sup>/);
  assert.match(result.markdown, /<br><span id="fn1">Preview ©<\/span>/);
  assert.doesNotMatch(result.markdown, /onclick|class=|\n/);
});

test('no-table HTML, ordinary text and Markdown keep baseline bytes', async () => {
  for (const [html, expected] of [
    ['<html><head><title>T</title></head><body><h1>Hello &amp; all</h1><p>words <code>x</code></p><ul><li>A</li><li>B</li></ul><a href="/next">next</a></body></html>', '# Hello & all\n\nwords x\n\n- A\n- B [next](/next)'],
    ['# Title\n\n| a | b |\n| --- | --- |\n| c | |\n\n`x` &amp; y', '# Title\n\n| a | b |\n| --- | --- |\n| c | |\n\n`x` & y'],
    ['plain text\n  next line', 'plain text\nnext line'],
    ['<p>before</p><script>"<table>fake</table>"</script><!--<table>fake</table>--><p>after</p>', 'before\n\nafter'],
  ]) assert.equal((await read(html)).markdown, expected);
  const surrounded = await read('<h2>Before</h2><p><a href="/a">A</a> &amp; B</p>' + MATRIX + '<p>After <code>x</code></p>');
  assert.equal(surrounded.markdown, '## Before\n\n[A](/a) & B\n\n' + MATRIX + '\n\nAfter x');
  assert.equal((await read('<nav>' + MATRIX + '</nav><p>after</p>')).markdown, 'after');
  const collision = await read('<nav>' + MATRIX + '</nav><p>TABLE&#67;ONTENTTOKEN0END</p>');
  assert.equal(collision.markdown, 'TABLECONTENTTOKEN0END');
  const wrapped = await read('<ul><li>Before<table><tr><td><code>*literal*\n\n[a|b]</code></td></tr></table>After</li></ul>');
  assert.match(wrapped.markdown, /<code>&#42;literal&#42;&#10;&#10;&#91;a&#124;b&#93;<\/code>/);
});

test('malformed, nested, unsafe and overlapping tables never turn into guessed mappings', async () => {
  for (const html of [
    '<table><tr><td>unclosed',
    '<table><tr><td>A<td>B</tr></table>', // explicit optional-tag refusal
    '<table><tr><td>' + TABLE + '</td></tr></table>',
    '<table><td>A</td></table>',
    '<table>fostered text<tr><td>A</td></tr></table>',
    '<table><tr><td colspan="-1">A</td></tr></table>',
    '<table><tr><td rowspan="1.5">A</td></tr></table>',
    '<table><tr><td>A</td><td rowspan="2">B</td></tr><tr><td colspan="2">overlap</td></tr></table>',
    '<table><tr><td><a href="javascript:bad()">unsafe</a></td></tr></table>',
    '<table><tr><td><script>bad()</script></td></tr></table>',
  ]) {
    const result = await read(html);
    assert.match(result.markdown, /^\[Table omitted:/, html);
    assert.doesNotMatch(result.markdown, /<table|bad\(\)/);
    assert.equal(result.truncated, true);
    assert.equal(result.capture.textTruncated, true);
    assert.equal(result.sourceOk, true);
    assert.equal(result.error, null);
    assert.equal(readMcpOutputSchema.safeParse(result).success, true);
  }
  const recovery = await read('<p>Before</p><table><tr><td rowspan="999">bad</td></tr></table>' + MATRIX + '<p>After</p>');
  assert.match(recovery.markdown, /Before\n\n\[Table omitted:/);
  assert.ok(recovery.markdown.includes(MATRIX));
  assert.match(recovery.markdown, /After$/);
  assert.equal((await read(TABLE)).truncated, false);
});

test('rows, cells, columns, expansion, table count/size, depth and token work have finite bounds', async () => {
  const row = '<tr><td>x</td></tr>';
  const cell = '<td>x</td>';
  for (const html of [
    `<table>${row.repeat(TABLE_LIMITS.rows + 1)}</table>`,
    `<table>${('<tr>' + cell.repeat(128) + '</tr>').repeat(65)}</table>`,
    `<table><tr>${cell.repeat(TABLE_LIMITS.columns + 1)}</tr></table>`,
    '<table><colgroup span="64"></colgroup><colgroup span="64"></colgroup><colgroup span="1"></colgroup>' + row + '</table>',
    '<table><tr><td colspan="65">x</td></tr></table>',
    '<table><tbody>' + ('<tr><td rowspan="64" colspan="64">x</td></tr>').repeat(64) + '</tbody></table>',
    TABLE.repeat(TABLE_LIMITS.tables + 1),
    '<table><tr><td>' + 'x'.repeat(TABLE_LIMITS.tableChars) + '</td></tr></table>',
    '<div>'.repeat(TABLE_LIMITS.depth + 1) + TABLE + '</div>'.repeat(TABLE_LIMITS.depth + 1),
    '<!--x-->'.repeat(TABLE_LIMITS.events + 1) + TABLE,
  ]) {
    const result = await read(html);
    assert.equal(result.truncated, true);
    assert.match(result.markdown, /Table omitted:/);
    assert.ok(result.markdown.length <= 40000);
  }
  assert.equal((await read(MATRIX)).truncated, false);
  const expanded = await read('<table><tbody><tr><td rowspan="0" colspan="64">x</td></tr>' + row.repeat(1023) + '</tbody></table>');
  assert.match(expanded.markdown, /span expansion limit/);
  assert.equal(expanded.truncated, true);
});

test('maxChars never returns a partial native table, including repeated identical tables', async () => {
  let fetches = 0;
  for (const maxChars of [-1, 0, 1.5, NaN, Infinity, 40001, '10', null]) {
    await assert.rejects(read(TABLE, { maxChars, fetchImpl: async () => { fetches++; return new Response(TABLE); } }), { code: 'invalid_markdown_limit' });
  }
  assert.equal(fetches, 0);
  const full = (await read(TABLE + TABLE)).markdown;
  for (const maxChars of [1, TABLE.length - 1, TABLE.length, TABLE.length + 2, full.length - 1, full.length]) {
    const result = await read(TABLE + TABLE, { maxChars });
    assert.ok(result.markdown.length <= maxChars);
    assert.equal(result.truncated, maxChars < full.length);
    const open = (result.markdown.match(/<table>/g) || []).length;
    const closed = (result.markdown.match(/<\/table>/g) || []).length;
    assert.equal(open, closed);
    assert.equal(result.capture.markdownLimitChars, maxChars);
  }
  assert.equal((await read(TABLE)).wordCount, 2);
});

test('source refusal, actual redirect, byte truncation and total deadline survive the table path', async () => {
  const denied = await read(MATRIX, { status: 403 });
  assert.equal(denied.sourceOk, false);
  assert.equal(denied.error.code, 'http_403');
  assert.equal(denied.markdown, MATRIX);
  assert.equal(denied.truncated, false);
  let calls = 0;
  const redirect = await read(MATRIX, { fetchImpl: async () => ++calls === 1
    ? new Response(null, { status: 302, headers: { location: 'https://final.example/dir/page' } })
    : new Response('<table><tr><td><a href="next">go</a></td></tr></table>') });
  assert.equal(redirect.requestedUrl, 'https://matrix.example/start');
  assert.equal(redirect.finalUrl, 'https://final.example/dir/page');
  assert.equal(redirect.url, redirect.finalUrl);
  assert.match(redirect.markdown, /href="https:\/\/final.example\/dir\/next"/);
  const huge = await read('<table><tr><td>' + 'x'.repeat(EXTRACT_MAX_BODY_BYTES) + '</td></tr></table>');
  assert.equal(huge.capture.bodyBytes, EXTRACT_MAX_BODY_BYTES);
  assert.equal(huge.capture.bodyTruncated, true);
  assert.equal(huge.capture.textTruncated, true);
  assert.doesNotMatch(huge.markdown, /<table/);
  await assert.rejects(read(TABLE, { timeout: 5, fetchImpl: async () => {
    const until = performance.now() + 15;
    while (performance.now() < until) { /* deliberately consume the same deadline */ }
    return new Response(TABLE);
  } }), { name: 'AbortError' });
  assert.equal((await read(TABLE)).truncated, false);
});

test('SSRF, redirect, compressed and stalled source refusals still precede table conversion', async () => {
  for (const fetchImpl of [
    async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    async () => new Response(TABLE, { headers: { 'content-encoding': 'gzip' } }),
    async () => ({ status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise(() => {}) }) } }),
  ]) await assert.rejects(read(TABLE, { fetchImpl, timeout: 20 }));
  assert.equal((await read(MATRIX)).markdown, MATRIX);
});
