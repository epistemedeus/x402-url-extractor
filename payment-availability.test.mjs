import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createMppDualStack } from './mpp-dual-stack.mjs';
import { implementedRailsForRoute, supportedRailsForRoute, operationIdentity, operationIdentityFromAction } from './operation-identity.mjs';

const options = () => ({ publicUrl: 'https://lab.example', network: 'eip155:84532',
  payTo: '0x1111111111111111111111111111111111111111',
  facilitatorClient: { verify() { throw Error('no verification'); }, settle() { throw Error('no settlement'); } },
  routes: [{ method: 'POST', path: '/extract/batch', amount: '0.01' }, { method: 'GET', path: '/read', amount: '0.005' }],
});
test('availability requires the configured runtime and exact eligible method/path', async () => {
  const off = createMppDualStack(options());
  const on = createMppDualStack({ ...options(), secretKey: randomBytes(32).toString('hex') });
  assert.deepEqual(implementedRailsForRoute('/read'), ['x402', 'mpp']);
  for (const mpp of [undefined, off, { enabled: true }]) {
    assert.deepEqual(supportedRailsForRoute('/read', { mpp }), ['x402']);
  }
  assert.deepEqual(supportedRailsForRoute('/extract/batch', { method: 'POST', mpp: on }), ['x402', 'mpp']);
  for (const [method, route] of [['GET', '/extract/batch'], ['HEAD', '/read'], ['POST', '/read'], ['GET', '/absent']]) {
    assert.deepEqual(supportedRailsForRoute(route, { method, mpp: on }), ['x402']);
  }
  assert.deepEqual(supportedRailsForRoute('/lockfile-pin-delta', { method: 'POST', mpp: { enabled: true, supportsRoute: () => true } }), ['x402']);
  assert.equal((await on.authorize(new Request('https://lab.example/read'))).kind, 'challenge');
  assert.equal((await on.authorize(new Request('https://lab.example/read', { method: 'POST' }))).kind, 'not_protected');
  assert.equal(off.supportsRoute('GET', '/read'), false);
});
test('identity projectors preserve available rails and reject invented authority', () => {
  assert.deepEqual(operationIdentity({ route: '/read', priceAtomic: '5000' }).supportedRails, ['x402']);
  const action = { route: '/read', priceAtomicUsdc: '5000', supportedRails: ['x402', 'mpp'] };
  assert.deepEqual(operationIdentityFromAction(action).supportedRails, action.supportedRails);
  for (const supportedRails of [[], ['x402', 'x402'], ['wallet'], ['mpp', 'x402', 'circle']]) {
    assert.throws(() => operationIdentity({ route: '/read', priceAtomic: '5000', supportedRails }), /valid available rails/);
  }
  assert.throws(() => operationIdentity({ route: '/lockfile-pin-delta', priceAtomic: '5000', supportedRails: ['x402', 'mpp'] }), /valid available rails/);
});
test('unusable startup configuration cannot supply an available runtime', () => {
  assert.throws(() => createMppDualStack({ ...options(), secretKey: 'short' }), /at least 32 bytes/);
  assert.throws(() => createMppDualStack({ ...options(), secretKey: randomBytes(32).toString('hex'), network: 'eip155:1' }), /not configured/);
});
