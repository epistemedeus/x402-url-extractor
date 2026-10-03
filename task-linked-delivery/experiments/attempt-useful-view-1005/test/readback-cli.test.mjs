import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { mountUsefulResultReuse } from '../../../../useful-result-reuse/http.mjs';
import { TOKEN } from '../../free-task-observation-100421/test/native-ports.mjs';

test('the operator command rejects ordinary current.json HTTP 200 after native enrollment is absent or rolled back', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-old-current-'));
  const app = express();
  mountUsefulResultReuse(app, { dataDir: dir, internalToken: TOKEN });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ordinary = await fetch(base + '/.well-known/useful-result-reuse/current.json');
    assert.equal(ordinary.status, 200);
    assert.equal((await ordinary.json()).schema, 'samedaydesk.useful-result-reuse.current.v1');
    await assert.rejects(() => promisify(execFile)(process.execPath, ['task-linked-delivery/experiments/attempt-useful-view-1005/bin/read-task-cut.mjs', 't' + 'ab'.repeat(31)], {
      env: { ...process.env, COMMERCE_BASE_URL: base, COMMERCE_INTERNAL_TOKEN: TOKEN },
    }), error => error.code === 1 && error.stdout === '' && /native_readback_contract_absent/.test(error.stderr));
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
