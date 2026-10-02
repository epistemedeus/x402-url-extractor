import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT=path.resolve(import.meta.dirname,'../../../..');
const PACKAGE=path.resolve(import.meta.dirname,'..');
const dir=mkdtempSync(path.join(tmpdir(),'scoped-root-diff-'));let patch='';
function replace(source,old,next){if(source.split(old).length!==2)throw new Error('exact_patch_context_required');return source.replace(old,next);}
function add(file,change){
  const old=readFileSync(path.join(ROOT,file),'utf8'),next=change(old);
  writeFileSync(path.join(dir,'old'),old);writeFileSync(path.join(dir,'new'),next);
  const diff=spawnSync('git',['diff','--no-index','--','old','new'],{cwd:dir,encoding:'utf8',timeout:5000,maxBuffer:1048576});
  if(diff.status!==1)throw new Error('patch_diff_failed');
  patch+=diff.stdout.replaceAll('a/old','a/'+file).replaceAll('b/new','b/'+file);
}
try{
  add('server.js',source=>{
    source=replace(source,'import { paymentMiddleware, x402ResourceServer }',
      'import { mountScopedRepairCommerce } from "./task-linked-delivery/experiments/scoped-repair-commerce-100348/route/mount.mjs";\nimport { isScopedRepairPath } from "./task-linked-delivery/experiments/scoped-repair-commerce-100348/route/paths.mjs";\nimport { paymentMiddleware, x402ResourceServer }');
    source=replace(source,'if (isPageChangeHttpPath(req.path) || isLockfilePinDeltaPath(req.path))',
      'if (isScopedRepairPath(req.path) || isPageChangeHttpPath(req.path) || isLockfilePinDeltaPath(req.path))');
    return replace(source,'app.use(commerceTelemetry.middleware);',
      'app.use(commerceTelemetry.middleware);\n// Free scoped qualification. Enrollment and existing paid work remain separate.\nmountScopedRepairCommerce(app, {\n  ...resolveHostedScanner(),\n  dataDir: process.env.SCOPED_REPAIR_PACKET_DIR || null,\n});');
  });
  add('commerce-events.mjs',source=>replace(source,'const EXACT_ROUTES = new Map([',
    'const EXACT_ROUTES = new Map([\n  // Known free calls use the existing non-paid request classification.\n  ...["deliver", "reuse", "accept", "review"].map((command) => {\n    const route = `/commerce/scoped-repair/${command}`;\n    return [route, { route, kind: "unmatched" }];\n  }),'));
  add('useful-result-reuse/store.mjs',source=>replace(source,'if (entry && entry.size >= maxFileBytes)',
    'if (entry && (entry.size >= maxFileBytes || entry.size + Buffer.byteLength(line) > maxFileBytes))'));
  // Real inherited defect: an observed wrong predicate value was classified
  // as a missing field, preventing the existing caller-owned repair/retest.
  add('experiments/seller-repair-service-100266/src/classify.mjs',source=>replace(source,'  if (intake.question === "declaration_contract") {\n    return {',
    '  if (expected.every((path) => observed.paths.includes(path)) && intake.expectedUsefulOutput.equals) {\n    return { ...view, outcome: "mismatch", reason: "observed_value_mismatch", nextAction: "repair", useful: false };\n  }\n  if (intake.question === "declaration_contract") {\n    return {'));
  for(const [script,version] of [['pack-consumer.mjs','0.2.0'],['pack-consumer-030.mjs','0.3.0'],['pack-consumer-040.mjs','0.4.0'],['pack-consumer-041.mjs','0.4.1']]){
    const file='experiments/seller-repair-service-100266/bin/'+script;
    const archive=readFileSync(path.join(ROOT,'experiments/seller-repair-service-100266/candidate/seller-repair-external-consumer-'+version+'.tar.gz'));
    const hash=createHash('sha256').update(archive).digest('hex');
    add(file,source=>{
      source=source.replace(/import \{ ([^}]+) \} from "node:fs";/,(_m,names)=>'import { existsSync, '+names+' } from "node:fs";');
      return replace(source,'function pack() {',
        'function pack() {\n  // A received version is sealed. Changed source requires a new version.\n  if (existsSync(ARCHIVE)) {\n    const sealed = readFileSync(ARCHIVE);\n    if (sealed.length !== '+archive.length+' || sha256(sealed) !== "'+hash+'") throw new Error("sealed archive changed; export a successor");\n    process.stdout.write(JSON.stringify({ version: "'+version+'", sha256: sha256(sealed), bytes: sealed.length, sealed: true }) + "\\n");\n    return;\n  }');
    });
  }
  const candidate=path.join(PACKAGE,'export/public/manifest.json');
  try{
    const assets=JSON.parse(readFileSync(candidate,'utf8')).assets;
    add('public-acquisition/manifest.json',source=>{const manifest=JSON.parse(source);manifest.assets.push(...assets);return JSON.stringify(manifest,null,2)+'\n';});
  }catch(e){if(e.code!=='ENOENT')throw e;}
  writeFileSync(path.join(PACKAGE,'route/ROOT-INTEGRATION.patch'),patch);
  process.stdout.write(JSON.stringify({files:(patch.match(/^diff --git/gm)||[]).length,bytes:Buffer.byteLength(patch)})+'\n');
}finally{rmSync(dir,{recursive:true,force:true});}
