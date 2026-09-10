// Copied to an archive's test/ directory; verifies the actual installed package.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>JSON.parse(readFileSync(join(root,path),'utf8'));
const manifest=read('CONSUMER-PROVENANCE.json');
const pkg=read('package.json');
function verify(document) {
  assert.equal(document.schema,'consumer-kit.provenance.v1');
  assert.ok(['s137-consumer-evidence-kit','s178-consumer-repeat-kit'].includes(pkg.name));
  assert.deepEqual(document.package,{name:pkg.name,version:pkg.version,private:pkg.private});
  assert.equal(pkg.private,true);
  const pin=pkg.name==='s178-consumer-repeat-kit'?read('PINS.json').reviewedSource.sha:pkg.pin;
  assert.match(pin,/^[a-f0-9]{40}$/);
  assert.equal(document.sourceRevision,pin);
  const required=pkg.name==='s178-consumer-repeat-kit'
    ? ['vendor/s137-consumer-evidence-jobs/src/release-brief/schema.mjs','vendor/s137-consumer-evidence-jobs/src/release-brief/transform.mjs','vendor/s137-consumer-evidence-jobs/src/packet.mjs','vendor/s137-consumer-evidence-jobs/scripts/cli.mjs','src/adapters/s137-release-brief.mjs','src/run-job.mjs','bin/s178-cli.mjs']
    : ['src/release-brief/schema.mjs','src/release-brief/transform.mjs','src/packet.mjs','bin/cli.mjs'];
  assert.deepEqual(Object.keys(document.files).sort(),required.sort());
  for(const [path,sha256] of Object.entries(document.files)) {
    assert.equal(createHash('sha256').update(readFileSync(join(root,path))).digest('hex'),sha256,path);
  }
}
test('installed consumer manifest, source pin and runtime bytes agree',()=>verify(manifest));
test('merchant version cannot replace consumer version',()=>{
  const changed=structuredClone(manifest);changed.package.version='not-the-consumer-version';
  assert.throws(()=>verify(changed));
});
test('changed source pin is refused',()=>{
  const changed=structuredClone(manifest);changed.sourceRevision='0'.repeat(40);
  assert.throws(()=>verify(changed));
});
test('changed or omitted runtime digest is refused',()=>{
  const changed=structuredClone(manifest);const path=Object.keys(changed.files)[0];
  changed.files[path]='0'.repeat(64);assert.throws(()=>verify(changed));
  delete changed.files[path];assert.throws(()=>verify(changed));
});
