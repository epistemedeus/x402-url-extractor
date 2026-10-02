import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { coldReceipt } from '../export/cold-receipt.mjs';

test('licensed candidate reproduces exact committed bytes and passes cold acquisition/restart',async()=>{
  const pkg=fileURLToPath(new URL('../',import.meta.url)),candidate=path.join(pkg,'export/public');
  const provenance=JSON.parse(await readFile(path.join(candidate,'bytes/task-demand-100339/0.1.0/provenance.json')));
  const fresh=await mkdtemp(path.join(tmpdir(),'task-demand-repack-'));
  try {
    const repack=spawnSync(process.execPath,[path.join(pkg,'export/pack.mjs'),'--source-commit',provenance.sourceCommit,'--out',fresh],{encoding:'utf8',timeout:15000});
    assert.equal(repack.status,0,repack.stderr);
    assert.equal(JSON.parse(repack.stdout).archiveSha256,provenance.archiveSha256);
    const receipt=await coldReceipt(fresh);
    assert.equal(receipt.archive.sha256,provenance.archiveSha256);
    assert.equal(receipt.productionHosted,false);assert.equal(receipt.restartedReplay,true);assert.equal(receipt.changedEvidenceReplay,true);
    assert.equal(receipt.questions.length,2);
  } finally {await rm(fresh,{recursive:true,force:true});}
});
