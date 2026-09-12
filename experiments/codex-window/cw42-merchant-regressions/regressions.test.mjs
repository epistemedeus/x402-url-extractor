import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checkout = process.env.CW42_CHECKOUT;
assert.ok(checkout, 'Use run.mjs with an explicit checkout');
const requireTarget = createRequire(join(checkout, 'package.json'));
const targetImport = (path) => import(pathToFileURL(join(checkout, path)).href);
const dependency = (name) => import(pathToFileURL(requireTarget.resolve(name)).href);
const PORT = 55549;
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = 'https://agents.samedaydesk.com';
const ROUTE = '/vendor-budget-impact';
const runtime = await mkdtemp(join(here, 'runtime/run-'));
const records = [];
const children = new Set();
const hash = (text) => createHash('sha256').update(text).digest('hex');
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const sourceFiles = git('ls-files', '-z').split('\0').filter(p => p && !p.startsWith('experiments/'));
const sourceDigest = () => hash(sourceFiles.map(p => `${p}\0${existsSync(join(checkout, p)) ? hash(readFileSync(join(checkout, p))) : 'MISSING'}`).join('\n'));
const beforeDigest = sourceDigest();
const provenance = {
  schema: 'cw42.merchant-regression.v1', checkout, sourceHead: head,
  sourceDigest: beforeDigest, sourceDigestScope: 'git tracked files except experiments; current bytes, not just HEAD',
  trackedStatus: git('status', '--porcelain', '--untracked-files=no'),
  harnessHead: execFileSync('git', ['-C', here, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  harnessDigest: hash(['run.mjs', 'network-fence.mjs', 'regressions.test.mjs'].map(p => readFileSync(join(here, p), 'utf8')).join('\n')),
  node: process.version, startedAt: new Date().toISOString(),
  packages: Object.fromEntries(['zod', '@modelcontextprotocol/sdk', '@x402/fetch', 'agent-payment-policy'].map(name => {
    const lock = JSON.parse(readFileSync(join(checkout, 'package-lock.json')));
    return [name, lock.packages[`node_modules/${name}`]?.version];
  })),
  boundaries: { workers: 1, nodeHeapMiB: 768, port: PORT, realSigning: false, realPayment: false, realFacilitator: false, evidenceClass: 'self-authored local regression; synthetic settlement only' },
};

async function check(t, id, fn) {
  await t.test(id, async () => {
    const row = { id, passed: false };
    records.push(row);
    try { await fn(row); row.passed = true; }
    catch (e) { row.error = e.message.slice(0, 1200); throw e; }
  });
}
const delay = ms => new Promise(r => setTimeout(r, ms));
async function assertPortFree() {
  const probe = createNetServer();
  await new Promise((ok, bad) => { probe.once('error', bad); probe.listen(PORT, '127.0.0.1', ok); });
  await new Promise(ok => probe.close(ok));
}
async function stop(child) {
  if (!children.has(child)) return;
  // Only the process group created by this harness. Never search/kill by name.
  try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
  for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await delay(50);
  if (child.exitCode === null && child.signalCode === null) throw new Error(`Owned process group ${child.pid} did not stop after TERM`);
  children.delete(child);
}
async function merchant({ enabled = '1', env = {}, root = checkout } = {}) {
  await assertPortFree();
  const data = await mkdtemp(join(runtime, 'merchant-'));
  const events = join(data, 'fence.jsonl');
  const childEnv = {
    PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC',
    NODE_OPTIONS: `--max-old-space-size=768 --import=${join(here, 'network-fence.mjs')}`,
    PORT: String(PORT), PUBLIC_URL: ORIGIN, COMMERCE_DATA_DIR: data,
    COMMERCE_RECONCILIATION_INTERVAL_MS: '86400000',
    FACILITATOR: 'xpay', FACILITATOR_URL: 'https://cw42-facilitator.invalid',
    MPP_SECRET_KEY: 'cw42-public-local-test-only-32-chars',
    LOCKFILE_PIN_DELTA_ENABLED: '0', EXTRACT_BATCH_ENABLED: '0',
    VENDOR_BUDGET_IMPACT_MAX_WORKERS: '1',
    CW42_FAKE_FACILITATOR: '1', CW42_EVENTS: events, ...env,
  };
  if (enabled !== undefined && enabled !== 'unset') childEnv.VENDOR_BUDGET_IMPACT_ENABLED = enabled;
  const child = spawn(process.execPath, ['--max-old-space-size=768', 'server.js'], {
    cwd: root, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let logs = '';
  child.stdout.on('data', b => { logs = (logs + b).slice(-12000); });
  child.stderr.on('data', b => { logs = (logs + b).slice(-12000); });
  let spawnError;
  child.on('error', e => { spawnError = e; });
  for (let i = 0; i < 200; i++) {
    if (spawnError || child.exitCode !== null || child.signalCode !== null || logs.includes(`x402-merchant listening on :${PORT}`)) break;
    await delay(50);
  }
  return {
    child, events, data, ready: logs.includes(`x402-merchant listening on :${PORT}`),
    logs: () => logs, stop: () => stop(child),
    eventsRead: () => existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [],
  };
}
async function http(path, { raw, headers = {}, method = raw === undefined ? 'GET' : 'POST' } = {}) {
  const response = await fetch(BASE + path, {
    method, headers: { ...(raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : {}), signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); }
  catch {
    const data = text.split('\n').find(line => line.startsWith('data: '));
    try { body = JSON.parse(data.slice(6)); } catch { body = text.slice(0, 400); }
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}
function pair(before, after) {
  const snapshot = value => `{"rows":[{"field":"price","value":${value},"unit":"USD/unit"}]}`;
  return `{"before":${snapshot(before)},"after":${snapshot(after)}}`;
}
function syntheticCredential(challenge, id) {
  const accepted = challenge.accepts.find(r => r.scheme === 'exact' && r.network === 'eip155:8453');
  assert.ok(accepted);
  return Buffer.from(JSON.stringify({
    x402Version: 2, resource: challenge.resource, accepted,
    payload: { signature: `0x${'4'.repeat(130)}`, authorization: {
      from: '0x1111111111111111111111111111111111111111', to: accepted.payTo,
      value: accepted.amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300),
      nonce: `0x${hash(id)}`,
    } },
    extensions: { 'payment-identifier': { info: { required: true, id } } },
  })).toString('base64');
}
function paidSummary(r) {
  return { httpStatus: r.status, ok: r.body?.ok, charged: r.body?.charged,
    analysis: r.body?.analysis, transport: r.body?.transport, digest: r.body?.digest,
    fieldChanges: r.body?.engine?.fieldChanges, counts: r.body?.engine?.counts,
    actions: r.body?.engine?.actions, code: r.body?.code, error: r.body?.error };
}
// Maintained client sees its canonical HTTPS origin; bytes travel only via this
// explicit loopback HTTP adapter. Neither production HTTP nor TLS is contacted.
const clientRequests = [];
async function clientFetch(input, init) {
  const request = input instanceof Request && !init ? input : new Request(input, init);
  const url = new URL(request.url);
  assert.equal(url.origin, ORIGIN);
  const raw = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
  clientRequests.push({ method: request.method, path: url.pathname, raw, syntheticPaid: request.headers.has('payment-signature') });
  return new Promise((ok, bad) => {
    const headers = Object.fromEntries(request.headers);
    headers.host = url.host; headers['x-forwarded-host'] = url.host; headers['x-forwarded-proto'] = 'https';
    if (raw !== undefined) headers['content-length'] = Buffer.byteLength(raw);
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path: url.pathname + url.search, method: request.method, headers }, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => ok(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', bad); req.setTimeout(15000, () => req.destroy(new Error('local client timeout')));
    req.end(raw);
  });
}

test('F5 dormant feature child-process boot isolation', { timeout: 180000 }, async t => {
  // Omit a real file in an owned copy, never rename/delete candidate source.
  const mirror = join(runtime, 'missing-fixture');
  await mkdir(mirror);
  const missing = 'vendor/vendor-budget-impact/fixtures/caller/before.json';
  for (const p of sourceFiles) {
    if (p === missing || !existsSync(join(checkout, p))) continue;
    await mkdir(dirname(join(mirror, p)), { recursive: true });
    await cp(join(checkout, p), join(mirror, p));
  }
  await symlink(join(checkout, 'node_modules'), join(mirror, 'node_modules'), 'dir');
  const scenarios = [
    { name: 'clean', env: {} },
    { name: 'malformed-price', env: { VENDOR_BUDGET_IMPACT_PRICE: 'not-a-price' } },
    { name: 'malformed-limit', env: { VENDOR_BUDGET_IMPACT_MAX_ROWS: 'not-a-limit' } },
    { name: 'malformed-all-limits', env: Object.fromEntries([
      'MAX_REQUEST_BYTES', 'MAX_SNAPSHOT_BYTES', 'MAX_RESPONSE_BYTES', 'MAX_MARKDOWN_BYTES',
      'MAX_ROWS', 'MAX_JSON_DEPTH', 'MAX_JSON_NODES', 'MAX_STRING_CHARS', 'TIMEOUT_MS', 'MAX_WORKERS',
    ].map(key => [`VENDOR_BUDGET_IMPACT_${key}`, 'not-a-limit'])) },
    { name: 'missing-discovery-fixture', env: {}, root: mirror },
  ];
  for (const enabled of ['unset', '0']) for (const scenario of scenarios) {
    await check(t, `F5.${enabled}.${scenario.name}`, async row => {
      const m = await merchant({ enabled, ...scenario });
      try {
        row.witness = { flag: enabled, perturbation: scenario.name, omittedFile: scenario.root ? missing : undefined, ready: m.ready };
        if (!m.ready) row.witness.startupError = m.logs().slice(-1800);
        assert.equal(m.ready, true, 'Dormant vendor state must not prevent incumbent server boot');
        const health = await http('/healthz');
        const incumbent = await http('/extract');
        const absent = await http(ROUTE, { raw: pair('1', '2') });
        row.witness.statuses = { health: health.status, incumbent: incumbent.status, vendor: absent.status };
        assert.equal(health.status, 200); assert.equal(incumbent.status, 402); assert.equal(absent.status, 404);
      } finally { await m.stop(); }
    });
  }
});

test('F6 actual HTTP and maintained customer numeric admission', { timeout: 180000 }, async t => {
  const m = await merchant();
  try {
    assert.equal(m.ready, true, m.logs().slice(-1800));
    const { runPreflight } = await targetImport('examples/customer-x402/src/preflight.mjs');
    const { runAuthorizedPurchase } = await targetImport('examples/customer-x402/src/purchase.mjs');
    const authorization = JSON.parse(readFileSync(join(checkout, 'examples/customer-x402/fixtures/authorization-vendor-budget.json')));
    delete authorization.body;
    const cases = [
      ['safe-boundary-distinct', '9007199254740991', '9007199254740992', true],
      ['integer-collapse', '9007199254740992', '9007199254740993', true],
      ['decimal-collapse', '0.1', '0.10000000000000001', true],
      ['decimal-distinct', '0.1', '0.10000000000000002', true],
      ['underflow-collapse', '0', '1e-400', true],
      ['subnormal-distinct', '0', '5e-324', true],
      ['negative-finite', '-1', '-2', true],
      ['finite-maximum', '1e308', '1.7976931348623157e308', true],
      ['overflow-rounds-finite-collapse', '1.7976931348623157e308', '1.7976931348623158e308', true],
      ['signed-zero-equivalent', '-0', '0', false],
      ['decimal-spelling-equivalent', '0.10', '1e-1', false],
    ];
    for (const [name, a, b, mathematicallyDifferent] of cases) {
      await check(t, `F6.raw.${name}`, async row => {
        const raw = pair(a, b);
        const unpaid = await http(ROUTE, { raw });
        row.witness = { raw, parsedValues: [JSON.parse(a), JSON.parse(b)], mathematicallyDifferent, unpaidStatus: unpaid.status };
        // A future exact-domain repair may reject unrepresentable numbers before payment.
        if (name.includes('collapse') && (unpaid.status === 400 || unpaid.status === 422)) { row.witness.refusedBeforePayment = true; return; }
        assert.equal(unpaid.status, 402);
        const challenge = JSON.parse(Buffer.from(unpaid.headers['payment-required'], 'base64').toString());
        const result = await http(ROUTE, { raw, headers: { 'payment-signature': syntheticCredential(challenge, `cw42_${name}_raw_0001`) } });
        row.witness.syntheticPaid = paidSummary(result);
        assert.equal(result.status, 200); assert.equal(result.body.charged, true);
        const changes = result.body.engine?.fieldChanges?.length;
        assert.equal(changes > 0, mathematicallyDifferent, 'Different exact numeric customer values must not be delivered as charged no-change');
      });
    }
    for (const token of ['1e400', '1.7976931348623159e308', '"1"', 'null', 'true', 'NaN', 'Infinity']) {
      await check(t, `F6.reject.${token}`, async row => {
        const raw = pair('1', token);
        const before = m.eventsRead().filter(e => e.path === '/verify' || e.path === '/settle').length;
        const response = await http(ROUTE, { raw });
        let clientError = null;
        try { await runPreflight({ url: ORIGIN + ROUTE, method: 'POST', body: raw, fetchImpl: clientFetch }); }
        catch (e) { clientError = e.message; }
        row.witness = { raw, httpStatus: response.status, clientError };
        assert.equal(response.status, 400); assert.ok(clientError);
        assert.equal(m.eventsRead().filter(e => e.path === '/verify' || e.path === '/settle').length, before);
      });
    }
    for (const [name, a, b] of cases.filter(c => ['integer-collapse', 'decimal-collapse', 'decimal-distinct'].includes(c[0]))) {
      await check(t, `F6.maintained-client.${name}`, async row => {
        const raw = pair(a, b); let stubCalls = 0;
        const start = clientRequests.length;
        row.witness = { raw };
        let preflight;
        try { preflight = await runPreflight({ url: ORIGIN + ROUTE, method: 'POST', body: raw, fetchImpl: clientFetch }); }
        catch (e) {
          row.witness.localRefusal = e.message;
          assert.ok(name.includes('collapse')); assert.equal(stubCalls, 0); return;
        }
        row.witness.preflight = { httpStatus: preflight.httpStatus, outcome: preflight.outcome, walletAccessed: preflight.walletAccessed };
        if (name.includes('collapse') && [400, 422].includes(preflight.httpStatus)) { row.witness.refusedBeforePayment = true; return; }
        const result = await runAuthorizedPurchase({
          authorization: { ...authorization, bodyRaw: raw }, approve: true, fetchImpl: clientFetch,
          // No key and no cryptographic signing: the client callback returns dummy bytes.
          loadAccount: async () => ({ address: '0x1111111111111111111111111111111111111111', signTypedData: async () => { stubCalls++; return `0x${'4'.repeat(130)}`; } }),
        });
        row.witness.result = { outcome: result.outcome, message: result.message,
          outputValid: result.evidence?.outputValid, outputDelivery: result.evidence?.outputDelivery,
          retainedBody: paidSummary({ status: result.evidence?.httpStatus, body: result.evidence?.retainedBody }) };
        row.witness.syntheticSignerCallbackCount = stubCalls;
        row.witness.transmitted = clientRequests.slice(start).map(r => ({ ...r, rawBytePreserved: r.raw === raw }));
        assert.equal(preflight.httpStatus, 402);
        assert.equal(stubCalls, 1, 'The maintained purchase path must reach the dummy callback once');
        assert.ok(row.witness.transmitted.every(r => r.rawBytePreserved));
        assert.equal(result.evidence?.httpStatus, 200);
        assert.equal(result.evidence?.outputValid, true, 'Control must reach maintained output verification');
        assert.ok(result.evidence?.retainedBody?.engine?.fieldChanges?.length > 0,
          'Maintained client accepted a charged no-change for different exact customer numeric values');
      });
    }
    await check(t, 'F6.network-boundary', async row => {
      row.witness = { events: m.eventsRead(), realSigning: false, realSettlement: false };
      assert.ok(!row.witness.events.some(e => e.kind.startsWith('blocked-')), 'Unexpected attempted external network access');
      assert.ok(row.witness.events.some(e => e.path === '/settle'));
    });
  } finally { await m.stop(); }
});

test('F7 live operation metadata, MCP construction and signed route coverage', { timeout: 90000 }, async t => {
  const m = await merchant();
  try {
    assert.equal(m.ready, true, m.logs().slice(-1800));
    await check(t, 'F7.runtime-x402-only', async row => {
      const unpaid = await http(ROUTE, { raw: pair('1', '2') });
      const mpp = await http(ROUTE, { raw: pair('1', '2'), headers: { authorization: 'Payment cw42-invalid-dummy' } });
      row.witness = { unpaidStatus: unpaid.status, wwwAuthenticate: unpaid.headers['www-authenticate'] || null, mppStatus: mpp.status, mppBody: mpp.body };
      assert.equal(unpaid.status, 402); assert.equal(unpaid.headers['www-authenticate'], undefined);
      assert.equal(mpp.body.code, 'mpp_not_accepted');
    });
    await check(t, 'F7.openapi-catalog-effects', async row => {
      const openapi = (await http('/openapi.json')).body;
      const mpp = (await http('/mpp-openapi.json')).body;
      const catalog = (await http('/api/actions')).body;
      const operation = openapi.paths[ROUTE].post;
      row.witness = { paymentInfo: operation['x-payment-info'], effect: operation['x-paid-effect'], catalog: catalog.actions?.find(x => x.route === ROUTE), mppAdvertised: Boolean(mpp.paths[ROUTE]) };
      assert.deepEqual(operation['x-payment-info'].protocols.map(Object.keys).flat(), ['x402']);
      assert.equal(row.witness.mppAdvertised, false);
      assert.deepEqual(row.witness.catalog?.paymentProtocols, ['x402']);
      assert.deepEqual(operation['x-paid-effect'].paymentProtocols, ['x402']);
    });
    await check(t, 'F7.purchase-evidence-per-operation', async row => {
      const manifest = (await http('/.well-known/agent-payment-evidence.json')).body;
      const operation = manifest.operations.find(x => x.path === ROUTE && x.method === 'POST');
      row.witness = { operation, evidence: manifest.evidence };
      assert.ok(operation);
      assert.deepEqual({ receiptMpp: Object.hasOwn(operation.receipt, 'mpp'), replayMpp: Object.hasOwn(operation.replay, 'mppRequirement') },
        { receiptMpp: false, replayMpp: false }, 'x402-only operation advertises MPP receipt/replay');
    });
    await check(t, 'F7.a2a-per-operation-protocols', async row => {
      const response = await http('/.well-known/agent-card.json');
      const skill = response.body.skills?.find(s => s.id === 'discover-paid-action-vendor-budget-impact');
      row.witness = { httpStatus: response.status, skill };
      assert.equal(response.status, 200); assert.ok(skill);
      assert.equal(skill.tags.includes('mpp'), false, 'x402-only vendor A2A skill advertises mpp tag');
      assert.doesNotMatch(skill.description, /x402\/MPP invocation contract/i);
    });
    const { Client } = await dependency('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await dependency('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const { default: Ajv } = await dependency('ajv');
    const client = new Client({ name: 'cw42-owned-regression', version: '1.0.0' });
    // HTTP listen is earlier than asynchronous MCP mount readiness.
    for (let i = 0; i < 100 && !m.logs().includes('MCP server:'); i++) await delay(50);
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(BASE + '/mcp')));
      const { tools } = await client.listTools();
      const tool = tools.find(x => x.name === 'vendor_budget_impact');
      await check(t, 'F7.mcp-zod-constructability', async row => {
        const valid = JSON.parse(pair('1', '2'));
        const validate = new Ajv({ strict: false }).compile(tool.inputSchema);
        const acceptsValid = validate(valid);
        const { vendorBudgetImpactMcpOutputSchema } = await targetImport('vendor-budget-impact.mjs');
        const actualZodOutput = vendorBudgetImpactMcpOutputSchema;
        const unpaid = await http(ROUTE, { raw: pair('1', '2') });
        const challenge = JSON.parse(Buffer.from(unpaid.headers['payment-required'], 'base64').toString());
        const paid = await http(ROUTE, { raw: pair('1', '2'), headers: { 'payment-signature': syntheticCredential(challenge, 'cw42_zod_control_0001') } });
        const acceptsPaid = actualZodOutput.safeParse(paid.body).success;
        row.witness = { inputSchema: tool.inputSchema, outputSchemaConstructed: Boolean(tool.outputSchema), acceptsValid,
          zodVersion: provenance.packages.zod,
          actualExportedZodOutputAcceptsSyntheticPaidResponse: acceptsPaid };
        assert.equal(acceptsValid, true); assert.ok(tool.outputSchema); assert.equal(acceptsPaid, true);
      });
      await check(t, 'F7.mcp-synthetic-paid-roundtrip', async row => {
        const args = JSON.parse(pair('1', '2'));
        const unpaid = await clientFetch(ORIGIN + ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
        const challenge = JSON.parse(Buffer.from(unpaid.headers.get('payment-required'), 'base64').toString());
        const dummy = JSON.parse(Buffer.from(syntheticCredential(challenge, 'cw42_mcp_paid_control_0001'), 'base64').toString());
        const call = await client.callTool({ name: tool.name, arguments: args, _meta: { 'x402/payment': dummy } });
        row.witness = { isError: call.isError === true, response: paidSummary({ status: call._meta?.['samedaydesk/http']?.status, body: call.structuredContent }),
          errorContent: call.isError ? call.content : undefined };
        assert.equal(call.isError === true, false);
        assert.equal(call.structuredContent?.charged, true);
        assert.equal(call.structuredContent?.engine?.fieldChanges?.length, 1);
      });
      await check(t, 'F7.mcp-unpaid-challenge-delivery', async row => {
        const valid = JSON.parse(pair('1', '2'));
        let call;
        try { call = await client.callTool({ name: tool.name, arguments: valid }); }
        catch (e) { call = { code: e.code, message: e.message }; }
        const wire = await http('/mcp', { raw: JSON.stringify({ jsonrpc: '2.0', id: 'cw42-unpaid', method: 'tools/call', params: { name: tool.name, arguments: valid } }), headers: { accept: 'application/json, text/event-stream' } });
        row.witness = { call, rawMcp: { httpStatus: wire.status, isError: wire.body?.result?.isError,
          structuredKeys: Object.keys(wire.body?.result?.structuredContent || {}), httpBridgeStatus: wire.body?.result?._meta?.['samedaydesk/http']?.status,
          error: wire.body?.error } };
        assert.ok(!call.code || call.code === -32042, 'SDK must receive the unpaid challenge, not an output-schema validation error');
        assert.equal(row.witness.rawMcp.httpBridgeStatus, 402);
      });
      await check(t, 'F7.mcp-schema-admission-parity', async row => {
        const invalid = { before: {}, after: {} };
        const validate = new Ajv({ strict: false }).compile(tool.inputSchema);
        const schemaAccepts = validate(invalid);
        const direct = await http(ROUTE, { raw: JSON.stringify(invalid) });
        let call;
        try { call = await client.callTool({ name: tool.name, arguments: invalid }); }
        catch (e) { call = { code: e.code, message: e.message }; }
        row.witness = { invalid, schemaAccepts, directHttpStatus: direct.status, call };
        assert.equal(direct.status, 400);
        assert.equal(schemaAccepts, false, 'Advertised MCP input schema admits missing rows that HTTP rejects');
      });
    } finally { await client.close(); }
    await check(t, 'F7.deployment-attestation-exact-route', async row => {
      const live = (await http('/.well-known/agent-payment-policy-service-deployment.json')).body;
      const envelope = live.payload ? live : live.statement || live.envelope;
      assert.ok(envelope?.payload, 'Live attestation envelope missing');
      const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString());
      const pem = readFileSync(join(checkout, 'service-deployment-ed25519-public.pem'), 'utf8');
      const { verifyServiceDeploymentStatement } = await dependency('agent-payment-policy');
      const offer = payload.deployments[0].settlement.find(x => x.protocol === 'x402');
      const activeNow = Date.now() >= Date.parse(payload.issuedAt) && Date.now() < Date.parse(payload.expiresAt);
      const now = activeNow ? Date.now() : Date.parse(payload.issuedAt) + 1000;
      const verify = path => {
        try { return verifyServiceDeploymentStatement(envelope, { publicKey: pem, request: { method: path === ROUTE ? 'POST' : 'GET', url: ORIGIN + path }, runtimeOffer: offer, now }); }
        catch (e) { return { error: e.message }; }
      };
      const incumbent = verify('/extract'); const vendor = verify(ROUTE);
      row.witness = { issuedAt: payload.issuedAt, expiresAt: payload.expiresAt, validAtWallClock: activeNow, verificationTime: new Date(now).toISOString(), signedRoutePresent: payload.deployments[0].routes.some(x => x.method === 'POST' && x.path === ROUTE), incumbent, vendor };
      assert.equal(incumbent.decision, 'verified_exact_binding', 'Historical-window control must verify existing signature');
      assert.equal(vendor.decision, 'verified_exact_binding', 'Vendor route is absent from published signed deployment coverage');
    });
  } finally { await m.stop(); }
});

after(async () => {
  for (const child of [...children]) await stop(child);
  const afterDigest = sourceDigest();
  const report = { ...provenance, finishedAt: new Date().toISOString(), sourceUnchanged: beforeDigest === afterDigest,
    sourceHeadAfter: git('rev-parse', 'HEAD'), remainingOwnedChildren: children.size,
    checks: records, passed: records.filter(x => x.passed).length, failed: records.filter(x => !x.passed).length };
  writeFileSync(process.env.CW42_RECEIPT, `${JSON.stringify(report, null, 2)}\n`);
  await rm(runtime, { recursive: true, force: true });
  console.log(`CW42 receipt: ${process.env.CW42_RECEIPT}; ${report.passed} passed, ${report.failed} failed`);
  assert.equal(report.sourceUnchanged, true, 'Candidate tracked source changed during run; evidence needs rerun');
  assert.equal(report.sourceHeadAfter, head, 'Candidate HEAD changed during run');
  await assertPortFree();
});
