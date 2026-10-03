import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
test('cold client requires its own task and transport without any credential or repository',()=>{
  const run=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../bin/scoped-repair.mjs'),'deliver'],
    {env:{PATH:process.env.PATH||''},encoding:'utf8',timeout:2000,maxBuffer:16384});
  assert.equal(run.status,2);const output=JSON.parse(run.stdout);
  assert.equal(output.reason,'request_required');assert.equal(output.executed,false);assert.equal(output.paymentPerformed,false);
});
