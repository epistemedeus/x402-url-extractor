import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {writeConsumerProvenance} from '../../s137-consumer-evidence-jobs/scripts/consumer-provenance.mjs';
const pack=join(dirname(fileURLToPath(import.meta.url)),'../../s137-consumer-evidence-jobs');
test('archive provenance writer uses actual package metadata and copied source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'consumer-provenance-'));
  try {
    const kit=join(pack,'../s153-consumer-distribution-gates/kit');
    const pkg=JSON.parse(readFileSync(join(kit,'package.json'),'utf8'));
    const index=readFileSync(join(kit,'src/index.mjs'),'utf8');
    pkg.pin=index.match(/export const PIN = "([a-f0-9]{40})"/)[1];
    writeFileSync(join(dir,'package.json'),JSON.stringify(pkg));
    const files=['src/release-brief/schema.mjs','src/release-brief/transform.mjs','src/packet.mjs','bin/cli.mjs'];
    for(const path of files){mkdirSync(dirname(join(dir,path)),{recursive:true});copyFileSync(join(pack,path==='bin/cli.mjs'?'scripts/cli.mjs':path),join(dir,path));}
    writeConsumerProvenance(dir,{sourceRevision:pkg.pin,files});
    const proc=spawnSync(process.execPath,['--test','test/consumer-provenance.test.mjs'],{cwd:dir,encoding:'utf8'});
    assert.equal(proc.status,0,proc.stdout+proc.stderr);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
