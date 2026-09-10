// Archive metadata records the actual consumer package, not the merchant version.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function writeConsumerProvenance(root,{sourceRevision,files}) {
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const document={
    schema:'consumer-kit.provenance.v1',
    package:{name:pkg.name,version:pkg.version,private:pkg.private},
    sourceRevision,
    note:'Local archive integrity metadata, not a signature, server version or independent attestation. Historical fixture SOURCE-PINS are repository excerpts, not installed package metadata.',
    files:Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')])),
  };
  writeFileSync(join(root,'CONSUMER-PROVENANCE.json'),`${JSON.stringify(document,null,2)}\n`);
  mkdirSync(join(root,'test'),{recursive:true});
  copyFileSync(fileURLToPath(new URL('./consumer-provenance-check.mjs',import.meta.url)),join(root,'test/consumer-provenance.test.mjs'));
}
