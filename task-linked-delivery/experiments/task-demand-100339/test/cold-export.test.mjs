import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { coldReceipt } from '../export/cold-receipt.mjs';
import { bytesDigest,digest } from '../src/bounds.mjs';

test('licensed candidate reproduces exact committed bytes and passes cold acquisition/restart',async()=>{
  const pkg=fileURLToPath(new URL('../',import.meta.url)),candidate=path.join(pkg,'export/public');
  const provenance=JSON.parse(await readFile(path.join(candidate,'bytes/task-demand-100339/0.1.0/provenance.json')));
  const fresh=await mkdtemp(path.join(tmpdir(),'task-demand-repack-'));
  try {
    // A received candidate remains pinned to its original committed bytes even
    // after the owned projection is repaired. Rebuild that historical tree,
    // rather than silently replacing it with the current checkout's source.
    const repo=path.resolve(pkg,'../../..'),prefix=path.relative(repo,pkg).replaceAll(path.sep,'/')+'/';
    assert.equal(digest(provenance.sourceFiles),provenance.sourceTreeDigest);
    const members=[];
    for(const member of provenance.sourceFiles){
      assert.ok(member.path.startsWith(prefix));
      const rel=member.path.slice(prefix.length);assert.ok(!rel.split('/').includes('..'));
      const committed=spawnSync('git',['show',provenance.sourceCommit+':'+member.path],{cwd:repo,maxBuffer:2_097_152});
      assert.equal(committed.status,0,committed.stderr.toString());
      assert.equal(bytesDigest(committed.stdout),member.sha256);assert.equal(committed.stdout.length,member.bytes);
      const dest=path.join(fresh,rel);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,committed.stdout);
      members.push(rel);
    }
    const archive=path.join(fresh,'candidate.tar.gz');
    const packed=spawnSync('tar',['--sort=name','--mtime=UTC 2026-10-02','--owner=0','--group=0','--numeric-owner','-czf',archive,...members],{cwd:fresh,encoding:'utf8',timeout:15000});
    assert.equal(packed.status,0,packed.stderr);
    assert.equal(bytesDigest(await readFile(archive)),provenance.archiveSha256);
    const receipt=await coldReceipt(candidate);
    assert.equal(receipt.archive.sha256,provenance.archiveSha256);
    assert.equal(receipt.productionHosted,false);assert.equal(receipt.restartedReplay,true);assert.equal(receipt.changedEvidenceReplay,true);
    assert.equal(receipt.questions.length,2);
  } finally {await rm(fresh,{recursive:true,force:true});}
});
