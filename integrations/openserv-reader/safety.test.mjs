import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { publicFetch } from './.runtime/reader-core/extract-batch-c1/public-fetch.mjs';
import { assertPublicHttpUrl } from './.runtime/reader-core/extract-batch-c1/url-guard.mjs';
import { EXTRACT_MAX_BODY_BYTES, EXTRACT_TIMEOUT_MS } from './.runtime/reader-core/extract-capture.mjs';

test('unchanged production fetch blocks private DNS, pins validated address and retains TLS defaults', async () => {
  for (const url of ['http://127.0.0.1', 'http://localhost', 'http://169.254.169.254', 'file:///etc/passwd', 'https://user:pass@fixture.example/']) assert.throws(() => assertPublicHttpUrl(url));
  let requests = 0;
  await assert.rejects(publicFetch('https://fixture.example/', {}, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], request: () => { requests++; } }), { code: 'ssrf_blocked' });
  assert.equal(requests, 0);
  await assert.rejects(publicFetch('https://fixture.example/', {}, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (url, options) => {
      requests++; assert.equal(url.protocol, 'https:'); assert.equal(options.agent, false);
      assert.equal(options.rejectUnauthorized, undefined, 'Node TLS verification default is retained');
      options.lookup(url.hostname, { all: false }, (error, address, family) => {
        assert.equal(error, null); assert.equal(address, '8.8.8.8'); assert.equal(family, 4);
      });
      const request = new EventEmitter(); request.end = () => queueMicrotask(() => request.emit('error', Object.assign(Error(), { code: 'CERT_HAS_EXPIRED' })));
      return request;
    },
  }), { code: 'CERT_HAS_EXPIRED' });
  assert.equal(requests, 1); assert.equal(EXTRACT_MAX_BODY_BYTES, 3000000); assert.equal(EXTRACT_TIMEOUT_MS, 12000);
});
