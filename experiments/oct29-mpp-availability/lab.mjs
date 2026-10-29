import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Credential } from 'mppx';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(process.env.MERCHANT_ROOT || '.');
const out = path.resolve(process.env.LAB_OUT || 'experiments/oct29-mpp-availability/evidence');
const baseline = process.argv.includes('--baseline');
const origin = 'https://agents.samedaydesk.com';
const route = '/distribution/agent-surface-budget-audit';
const evidencePath = '/.well-known/agent-payment-evidence.json';
const auditor = await import(pathToFileURL(path.resolve(process.env.AUDITOR_ROOT, 'integrity.mjs')));
const sha = value => createHash('sha256').update(value).digest('hex');
const scratch = await mkdtemp(path.join(tmpdir(), 'h64330-lab-'));
const calls = [];
const actorSecret = randomBytes(32).toString('hex');
const replayFixtures = [];
const facilitator = createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/supported') return res.end(JSON.stringify({
    kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {},
  }));
  res.statusCode = 500;
  res.end('{"error":"no_spend_lab_refusal"}');
});
facilitator.listen(0, '127.0.0.1');
await once(facilitator, 'listening');
const facilitatorUrl = `http://127.0.0.1:${facilitator.address().port}`;
await writeFile(path.join(scratch, 'guard.mjs'), `const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
 const u = new URL(input instanceof Request ? input.url : input);
 if (u.origin !== ${JSON.stringify(facilitatorUrl)} || u.pathname !== '/supported' || (init?.method || 'GET') !== 'GET') throw new Error('lab_outbound_refused');
 return original(input, init);
};\n`);
async function unusedPort() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise(r => s.close(r)); return port;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit'); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000); await done; clearTimeout(timer);
}
const paths = ['/healthz', '/openapi.json', '/openapi.yaml', '/swagger.json', '/mpp-openapi.json', '/openapi.mpp.json',
  '/api/actions', '/.well-known/x402', '/.well-known/x402.json', '/x402.json', '/api/x402',
  '/.well-known/agent-card.json', '/.well-known/agent.json', '/.well-known/agent-registration.json',
  '/skill.md', '/SKILL.md', '/llms.txt', '/mcp', '/', evidencePath, '/.well-known/paid-action-effects.json',
  '/.well-known/extraction-trial', '/.well-known/skills/index.json', '/.well-known/useful-result-reuse/current.json'];
const humanPaths = ['/', '/radar', '/platforms', '/platforms/methodology', '/alerts'];
async function capture(label, enabled, extraEnv = {}) {
  const port = await unusedPort();
  const child = spawn(process.execPath, ['--import', path.join(scratch, 'guard.mjs'), 'server.js'], {
    cwd: root, env: { PATH: process.env.PATH, PORT: String(port), PUBLIC_URL: origin,
      FACILITATOR: 'xpay', FACILITATOR_URL: facilitatorUrl,
      COMMERCE_ACTOR_SECRET: actorSecret,
      COMMERCE_DATA_DIR: path.join(scratch, 'data'), COMMERCE_RECONCILIATION_INTERVAL_MS: '86400000',
      MPP_SECRET_KEY: enabled ? randomBytes(32).toString('hex') : '',
      EXTRACT_BATCH_ENABLED: 'true', LOCKFILE_PIN_DELTA_ENABLED: 'true',
      ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = ''; child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`startup timeout: ${logs}`)), 15000);
      const check = () => { if (logs.includes('MCP server:') && logs.includes('listening on')) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', check); child.once('exit', code => { clearTimeout(timer); reject(Error(`startup ${code}: ${logs}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const responses = {};
    async function read(key, pathname = key, init = {}) {
      responses[key] = await new Promise((resolve, reject) => {
        const req = httpRequest(base + pathname, { method: init.method || 'GET',
          headers: { host: new URL(origin).host, 'x-forwarded-proto': 'https', ...init.headers } }, res => {
          const chunks = []; res.on('data', b => chunks.push(b));
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
        });
        req.setTimeout(15000, () => req.destroy(Error('lab timeout'))); req.on('error', reject); req.end(init.body);
      });
      return responses[key];
    }
    for (const p of paths) { const response = await read(p); assert.equal(response.status, 200, p); }
    const skillsIndex = JSON.parse(responses['/.well-known/skills/index.json'].body);
    for (const skill of skillsIndex.skills) {
      const p = `/.well-known/skills/${skill.name}/SKILL.md`;
      const response = await read(p); assert.equal(response.status, 200, p);
    }
    const sitemap = await read('/sitemap.xml');
    const platformPaths = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname).filter(p => p.startsWith('/platforms/'));
    for (const p of [...new Set([...humanPaths, ...platformPaths])]) await read(`human:${p}`, p, { headers: { accept: 'text/html' } });
    const catalog = JSON.parse(responses['/api/actions'].body);
    for (const action of catalog.actions) {
      const target = new URL(action.request.exampleUrl || action.url);
      const init = action.method === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action.request.example.body) } : {};
      await read(`runtime:${action.method} ${action.route}`, target.pathname + target.search, init);
    }
    // Additional declared methods share an action's stable identity and price.
    for (const p of ['/work/opportunity-preflight', '/commerce/payment-offer-preflight']) {
      const body = p.startsWith('/work/') ? { rewardUsd: 1, hours: 1, hourlyCostUsd: 1 } : { url: 'https://example.com/' };
      await read(`runtime:POST ${p}`, p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    for (const fixture of replayFixtures) {
      await read(`old-replay:${fixture.rail}`, fixture.path, { headers: fixture.headers });
      await read(`old-conflict:${fixture.rail}`, fixture.path + '&changed=1', { headers: fixture.headers });
    }
    const xdoc = JSON.parse(responses['/openapi.json'].body);
    const target = auditor.buildAuditTarget(origin, route, xdoc.paths[route].get).url;
    const targetPath = target.pathname + target.search;
    await read('challenge', targetPath);
    await read('wrong-method', route, { method: 'POST' });
    await read('head-only', '/work/opportunity-preflight?rewardUsd=1&hours=1&hourlyCostUsd=1', { method: 'HEAD' });
    await read('invalid-input', route + '?origin=http://127.0.0.1');
    await read('free-trial', '/work/opportunity-preflight?trial=1');
    const request = { message: { messageId: 'lab-discovery', role: 'ROLE_USER', parts: [{ text: 'list actions' }] } };
    await read('a2a-message', '/a2a/message:send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    const client = new Client({ name: 'h64330-discovery', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
    let tools;
    try { tools = (await client.listTools()).tools; } finally { await client.close(); }
    let modern = null;
    if (process.env.LAB_MODERN === '1') {
      const require = createRequire(path.join(root, 'package.json'));
      const { Client, StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')));
      const client = new Client({ name: 'h64330-current-client', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
      await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
      try {
        modern = { protocol: client.getNegotiatedProtocolVersion(), tools: (await client.listTools()).tools,
          free: await client.callTool({ name: 'careers_board_cold', arguments: {} }) };
        assert.equal(modern.protocol, '2026-07-28');
        assert.equal(modern.free.structuredContent.charged, false);
      } finally { await client.close(); }
    }
    // Maintained core entry. Its request callback replays only the exact real
    // mounted response just captured above. No DNS override or TLS bypass.
    const report = await auditor.auditIntegrity({ origin, route, x402Document: xdoc,
      mppDocument: JSON.parse(responses['/mpp-openapi.json'].body), requirePurchaseEvidence: true,
      requestImpl: async url => { assert.equal(String(url), String(target)); return { ...responses.challenge, body: Buffer.from(responses.challenge.body) }; },
      purchaseEvidenceLoader: async url => { assert.equal(String(url), origin + evidencePath); return JSON.parse(responses[evidencePath].body); },
    });
    const result = { label, enabled, responses, tools, modern, target: String(target), report, logs, replayFixtures: replayFixtures.map(({rail, body}) => ({rail, body})) };
    await writeFile(path.join(out, `${label}.json.gz`), gzipSync(JSON.stringify(result)));
    await writeFile(path.join(out, `${label}-audit.json`), JSON.stringify(report, null, 2) + '\n');
    return result;
  } finally { await stop(child); }
}
async function seedOldResults() {
  const { createIdempotencyReplay } = await import(pathToFileURL(path.join(root, 'idempotency-replay.mjs')));
  const journal = createIdempotencyReplay({ dataDir: path.join(scratch, 'data'), secret: actorSecret, publicUrl: origin });
  const payTo = '0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee';
  const asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const from = '0x1111111111111111111111111111111111111111';
  const request = { amount: '10000', currency: asset, recipient: payTo, methodDetails: { chainId: 8453, decimals: 6 } };
  const fixturePath = '/extract?url=https%3A%2F%2Fexample.com';
  const credentials = {
    x402: { 'payment-signature': Buffer.from(JSON.stringify({ x402Version: 2,
      accepted: { scheme: 'exact', network: 'eip155:8453', asset, payTo, amount: '10000' },
      payload: { signature: 'nonproduction-unsigned-fixture', authorization: { from, validBefore: String(Math.floor(Date.now()/1000) + 3600), nonce: '0x' + '1'.repeat(64) } },
      extensions: { 'payment-identifier': { info: { id: 'lab_old_result_64330' } } },
    })).toString('base64') },
    mpp: { authorization: Credential.serialize({ challenge: { id: 'nonproduction-unsigned-fixture', realm: new URL(origin).host, method: 'evm', intent: 'charge', request },
      payload: { from, to: payTo, value: '10000', signature: 'nonproduction-unsigned-fixture', validBefore: String(Math.floor(Date.now()/1000) + 3600) } }) },
  };
  for (const [rail, headers] of Object.entries(credentials)) {
    const body = JSON.stringify({ oldResult: rail, fixture: 'previously-retained-lab-result' });
    const binding = journal.bindingFor({ method: 'GET', url: origin + fixturePath, headers });
    assert.ok(binding, rail);
    assert.equal(await journal.store(binding, { status: 200, headers: { 'content-type': 'application/json', [rail === 'x402' ? 'payment-response' : 'payment-receipt']: 'lab-retained-receipt' }, body }), true);
    replayFixtures.push({ rail, headers, body, path: fixturePath });
  }
}
const json = (r, p) => JSON.parse(r.responses[p].body);
function checkCapture(r) {
  const catalog = json(r, '/api/actions');
  const health = json(r, '/healthz');
  assert.equal(health.paymentProtocols.mpp.enabled, r.enabled);
  assert.deepEqual(catalog.paymentProtocols, r.enabled ? ['x402', 'mpp'] : ['x402']);
  for (const group of [['/openapi.json', '/openapi.yaml', '/swagger.json'], ['/mpp-openapi.json', '/openapi.mpp.json'],
    ['/.well-known/agent-card.json', '/.well-known/agent.json'], ['/skill.md', '/SKILL.md']]) {
    for (const p of group) assert.equal(r.responses[p].body, r.responses[group[0]].body, p);
  }
  const manifest = json(r, '/.well-known/x402');
  for (const p of ['/.well-known/x402.json', '/x402.json', '/api/x402']) assert.deepEqual(json(r, p).items, manifest.items);
  const card = json(r, '/.well-known/agent-card.json');
  const xdoc = json(r, '/openapi.json');
  const mdoc = json(r, '/mpp-openapi.json');
  assert.deepEqual(json(r, 'a2a-message').message.parts[0].data, catalog);
  assert.deepEqual(json(r, '/').machineCommerce.paymentProtocols,
    [...catalog.paymentProtocols, ...(health.paymentProtocols.circleGateway.enabled ? ['circle-gateway-x402'] : [])]);
  for (const action of catalog.actions) {
    const rails = r.enabled && action.route !== '/lockfile-pin-delta' ? ['x402', 'mpp'] : ['x402'];
    if (r.modern) {
      assert.deepEqual(r.modern.tools.find(t => t._meta?.samedaydesk?.operation?.id === action.id)._meta.samedaydesk.operation,
        r.tools.find(t => t._meta?.samedaydesk?.operation?.id === action.id)._meta.samedaydesk.operation);
    }
    assert.deepEqual(action.supportedRails, rails, action.route);
    assert.deepEqual(action.paymentProtocols, rails, action.route);
    if (!rails.includes('mpp')) assert.equal(card.skills.find(s => s.operation?.id === action.id).tags.includes('mpp'), false);
    const info = xdoc.paths[action.route][action.method.toLowerCase()]['x-payment-info'];
    assert.deepEqual(info.operation.supportedRails, rails);
    assert.equal(info.protocols.some(p => p.mpp), rails.includes('mpp'));
    for (const identity of [manifest.items.find(i => i.resource.routeTemplate === action.route).identity,
      card.skills.find(s => s.operation?.id === action.id).operation,
      r.tools.find(t => t._meta?.samedaydesk?.operation?.id === action.id)._meta.samedaydesk.operation]) {
      assert.deepEqual(identity, info.operation, action.route);
    }
    assert.equal(Boolean(mdoc.paths[action.route]?.[action.method.toLowerCase()]), rails.includes('mpp'));
    assert.ok(r.responses['/skill.md'].body.includes(`${action.method} ${action.route}: ${action.priceUsdc} USDC through ${rails.join(' + ')}`));
  }
  for (const [key, response] of Object.entries(r.responses).filter(([key]) => key.startsWith('runtime:'))) {
    assert.equal(response.status, 402, key);
    assert.ok(response.headers['payment-required'], key);
    assert.equal(Boolean(response.headers['www-authenticate']), r.enabled && !key.includes('/lockfile-pin-delta'), key);
  }
  assert.equal(r.responses['head-only'].status, 402);
  assert.equal(r.responses['head-only'].headers['www-authenticate'], undefined);
  assert.equal(r.responses['wrong-method'].headers['www-authenticate'], undefined);
  assert.equal(r.responses['invalid-input'].status, 400);
  assert.equal(r.responses['invalid-input'].headers['www-authenticate'], undefined);
  assert.equal(r.responses['free-trial'].status, 200);
  assert.equal(JSON.parse(r.responses['free-trial'].body).charged, false);
  assert.equal(mdoc.paths['/lockfile-pin-delta'], undefined);
  assert.equal(mdoc.paths['/gateway/commerce/payment-offer-preflight'], undefined);
  assert.equal(Boolean(xdoc.paths['/gateway/commerce/payment-offer-preflight']), health.paymentProtocols.circleGateway.enabled);
  assert.equal(json(r, '/.well-known/agent-registration.json').services.some(s => s.name === 'MPP'), r.enabled);
  if (!r.enabled) {
    assert.doesNotMatch(r.responses['/skill.md'].body, /pay through MPP|native MPP Payment authentication|WWW-Authenticate/);
    assert.doesNotMatch(r.responses['/llms.txt'].body, /native MPP Payment authentication|For MPP|WWW-Authenticate/);
    assert.doesNotMatch(r.responses['/mcp'].body, /HTTP actions also accept native MPP/);
    assert.ok(Object.values(mdoc.paths).every(item => Object.values(item).every(op => !op['x-payment-info'])));
  }
  for (const {rail, body} of r.replayFixtures) {
    const replay = r.responses[`old-replay:${rail}`];
    assert.equal(replay.status, 200); assert.equal(replay.body, body);
    assert.equal(replay.headers['x-payment-replay'], 'hit');
    assert.equal(r.responses[`old-conflict:${rail}`].status, 409);
  }
}
function comparePreserved(before, after) {
  for (const [p, response] of Object.entries(before.responses).filter(([p]) => p.startsWith('human:'))) {
    assert.equal(after.responses[p].body, response.body, p);
  }
  for (const p of [evidencePath, '/.well-known/paid-action-effects.json', '/.well-known/skills/index.json', '/.well-known/extraction-trial']) {
    assert.equal(after.responses[p].body, before.responses[p].body, p);
  }
  for (const p of Object.keys(before.responses).filter(p => p.startsWith('/.well-known/skills/'))) assert.equal(after.responses[p].body, before.responses[p].body, p);
  const economics = r => ({ network: json(r, '/api/actions').network, payTo: json(r, '/api/actions').payTo,
    actions: json(r, '/api/actions').actions.map(({id, route, method, priceAtomicUsdc, billingBasis, request, response}) => ({id, route, method, priceAtomicUsdc, billingBasis, request, response})) });
  // Wallet-policy examples are evaluated at each process start. This field is
  // an observation clock, not an economic, request or response-schema term.
  const stable = value => JSON.parse(JSON.stringify(value, (key, value) => key === 'evaluatedAt' ? undefined : value));
  assert.deepEqual(stable(economics(after)), stable(economics(before)));
  assert.deepEqual(json(after, '/.well-known/x402').items.map(i => i.accepts), json(before, '/.well-known/x402').items.map(i => i.accepts));
  const mcpEconomics = r => r.tools.filter(t => t._meta?.x402?.accepts).map(t => ({ name: t.name, accepts: t._meta.x402.accepts }));
  assert.deepEqual(mcpEconomics(after), mcpEconomics(before));
  assert.deepEqual(JSON.parse(Buffer.from(after.responses.challenge.headers['payment-required'], 'base64')),
    JSON.parse(Buffer.from(before.responses.challenge.headers['payment-required'], 'base64')));
}
try {
  const wrapper = spawnSync(process.execPath, [path.resolve(process.env.AUDITOR_ROOT, 'action/run.mjs')], {
    cwd: scratch, env: { PATH: process.env.PATH, INPUT_ORIGIN: 'https://127.0.0.1', INPUT_ROUTE: route }, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(wrapper.status, 1); assert.match(wrapper.stderr, /not public/);
  await writeFile(path.join(out, 'action-local-refusal.json'), JSON.stringify({ exit: wrapper.status, stdout: wrapper.stdout, stderr: wrapper.stderr }, null, 2) + '\n');
  await seedOldResults();
  if (baseline) {
    const r = await capture('baseline', false);
    assert.equal(r.report.ok, false);
    assert.deepEqual(r.report.routes[0].findings, ['mpp_challenge_invalid']);
    assert.equal(r.responses.challenge.status, 402);
    console.log('baseline reproduced mpp_challenge_invalid');
  } else {
    const off = await capture('disabled', false);
    const on = await capture('enabled', true);
    const offAgain = await capture('disabled-again', false);
    for (const r of [off, on, offAgain]) {
      checkCapture(r);
      assert.equal(r.report.ok, true, JSON.stringify(r.report.routes[0].findings));
      assert.equal(r.responses.challenge.status, 402);
      assert.equal(Boolean(r.responses.challenge.headers['www-authenticate']), r.enabled);
    }
    const before = JSON.parse(gunzipSync(await readFile(path.join(out, 'baseline.json.gz'))));
    for (const r of [off, on, offAgain]) comparePreserved(before, r);
    await writeFile(path.join(out, 'acceptance.json'), JSON.stringify({
      source: root, cases: [off, on, offAgain].map(r => ({ label: r.label, ok: r.report.ok, protocols: r.report.routes[0].protocols,
        human: Object.fromEntries(Object.entries(r.responses).filter(([p]) => p.startsWith('human:')).map(([p,v]) => [p, sha(v.body)])) })),
      economicAuthorityAndReplayContractUnchanged: true, oldResultReplay: ['x402', 'mpp'], verify: 0, settle: 0,
    }, null, 2) + '\n');
    const limited = await capture('optional-routes-and-circle-off', true, { EXTRACT_BATCH_ENABLED: 'false', LOCKFILE_PIN_DELTA_ENABLED: 'false', CIRCLE_GATEWAY_ENABLED: 'false' });
    checkCapture(limited);
    assert.equal(limited.report.ok, true);
    for (const p of ['/openapi.json', '/mpp-openapi.json']) {
      for (const route of ['/extract/batch', '/lockfile-pin-delta', '/gateway/commerce/payment-offer-preflight']) assert.equal(json(limited, p).paths[route], undefined);
    }
    let refusal;
    await assert.rejects(capture('startup-refused', true, { MPP_SECRET_KEY: 'short' }), error => {
      refusal = error.message; return /at least 32 bytes/.test(refusal) && !refusal.includes('listening on');
    });
    await writeFile(path.join(out, 'startup-refusal.txt'), refusal + '\n');
    assert.throws(() => auditor.normalizeOrigin('https://127.0.0.1'), /not public/);
    await assert.rejects(auditor.auditIntegrity({ origin, x402Document: json(off, '/openapi.json'), route: '/not-declared-h64330' }), /not declared/);
    console.log('off/on/off real-handler audit, projections, preservation and old recovery passed; unavailable routes, Circle-off, startup and strict refusals passed');
  }
  assert.ok(calls.length > 0);
  assert.ok(calls.every(c => c === 'GET /supported'), JSON.stringify(calls));
  await writeFile(path.join(out, baseline ? 'baseline-facilitator.json' : 'facilitator.json'), JSON.stringify({ calls, verify: 0, settle: 0 }, null, 2) + '\n');
} finally {
  await new Promise(r => facilitator.close(r));
  await rm(scratch, { recursive: true, force: true });
}
