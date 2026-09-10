import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink, copyFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BLOCKED_DIR_NAMES,
  DEFAULT_SLUG,
  OFFICIAL_XAGT_PLUGIN_PIN,
  VENDOR_DIR,
  VENDOR_SHA256,
  buildPageChangePackage,
  classifyExclusion,
  sha256,
  planPackageFiles,
} from "./scripts/page-change-xagent-package.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const officialRoot = process.env.XAGT_PLUGIN_ROOT;
const head = () => spawnSync("git",["-C",root,"rev-parse","HEAD"],{encoding:"utf8"}).stdout.trim();

test("exclusions keep vendor source and drop validator-blocked names", () => {
  assert.equal(classifyExclusion(`${VENDOR_DIR}/compare.mjs`, Buffer.from("export const x = 1;\n")), null);
  assert.equal(classifyExclusion("service-deployment-ed25519-public.pem", Buffer.from("-----BEGIN PUBLIC KEY-----\n")), "secret_filename");
  assert.equal(classifyExclusion("node_modules/express/index.js", Buffer.from("module.exports = 1;\n")), "blocked_directory:node_modules");
  assert.equal(classifyExclusion("experiments/s118-xagent/submissions/mcp-hackathon/x/source/a.mjs", Buffer.from("export {}\n")), "contest_wrapper");
  const fakeKey = ["sk", "live", "secret", "do", "not", "store"].join("-");
  assert.equal(classifyExclusion("commerce-settlement-source-delivery.test.mjs", Buffer.from(`apiKey: "${fakeKey}"\n`)), "secret_content");
  assert.deepEqual([...BLOCKED_DIR_NAMES], ["node_modules", ".git", "dist", "build", ".next"]);
});

test("commit package preserves vendor/ and is stdlib-runnable", { timeout: 60_000 }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "s118-xagent-package-"));
  const outDir=join(scratch,DEFAULT_SLUG);
  try {
    const built = await buildPageChangePackage({
      repoRoot: root,
      commit: head(),
      outDir,
      reviewCommit: head(),
    });
    assert.equal(built.slug, DEFAULT_SLUG);
    assert.ok(existsSync(join(outDir, "source", VENDOR_DIR, "compare.mjs")));
    assert.ok(existsSync(join(outDir, "source", VENDOR_DIR, "NOTICE.md")));
    assert.equal(existsSync(join(outDir, "source", "service-deployment-ed25519-public.pem")), false);
    assert.equal(existsSync(join(outDir, "source", "node_modules")), false);
    assert.equal(existsSync(join(outDir, "source", ".git")), false);
    assert.ok(existsSync(join(outDir, "source", "page-change-http.mjs")));
    assert.ok(existsSync(join(outDir, "source", "scripts", "page-change-xagent-package.mjs")));
    for (const [name, digest] of Object.entries(VENDOR_SHA256)) {
      const bytes = readFileSync(join(outDir, "source", VENDOR_DIR, name));
      assert.equal(sha256(bytes), digest, name);
    }
    const submission = await readFile(join(outDir, "SUBMISSION.md"), "utf8");
    assert.match(submission, /Not submitted/);
    assert.match(submission, /vendor\//);
    const rights = await readFile(join(outDir, "RIGHTS.md"), "utf8");
    assert.match(rights, /UNSIGNED OPERATOR DRAFT/);
    assert.equal(rights.includes("SIGNED BY"), false);
    const manifest = JSON.parse(await readFile(join(outDir, "submission.json"), "utf8"));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.slug, DEFAULT_SLUG);
    assert.equal(manifest.reviewCommit, head());
    assert.equal(manifest.deploymentProofUrl, "https://agents.samedaydesk.com/.well-known/xagent-verification.json");
    const verification = await readFile(join(outDir, "verification", "README.md"), "utf8");
    assert.match(verification, /curl /);
    assert.match(verification, /health/);
    assert.match(verification, /missing_source_commit/);

    const compare = spawnSync(process.execPath, [
      join(outDir, "source", "examples/customer-x402/bin/page-change.mjs"),
      "compare",
      "--before",
      join(outDir, "source", "examples/customer-x402/fixtures/page-change/merchant/unchanged-before.json"),
      "--after",
      join(outDir, "source", "examples/customer-x402/fixtures/page-change/merchant/unchanged-after.json"),
      "--fields",
      "title,description",
    ], { encoding: "utf8", timeout: 20_000 });
    assert.equal(compare.status, 0, compare.stderr);
    const report = JSON.parse(compare.stdout);
    assert.equal(report.verdict, "unchanged");
    assert.equal(report.claims.fresh, false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("commit package matches git blob bytes for included first-party files", { timeout: 30_000 }, async () => {
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const scratch = await mkdtemp(join(tmpdir(), "s118-xagent-commit-package-"));
  const outDir=join(scratch,DEFAULT_SLUG);
  try {
    const built = await buildPageChangePackage({
      repoRoot: root,
      commit: head,
      outDir,
      reviewCommit: head,
    });
    assert.equal(built.reviewCommit, head);
    const vendor = readFileSync(join(outDir, "source", VENDOR_DIR, "compare.mjs"));
    const fromGit = spawnSync("git", ["-C", root, "show", `${head}:${VENDOR_DIR}/compare.mjs`]);
    assert.equal(sha256(vendor), sha256(fromGit.stdout));
    assert.equal(existsSync(join(outDir, "source", "service-deployment-ed25519-public.pem")), false);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("sidecar pin constant matches the package builder pin", () => {
  const sidecar = readFileSync(join(root, "scripts/page-change-xagent-sidecar.mjs"), "utf8");
  assert.match(sidecar, new RegExp(OFFICIAL_XAGT_PLUGIN_PIN));
  assert.equal(sidecar.includes("a9f5526f89ca67138174ff8f2f8aa63812683dd5"), false);
});

test("official offline validator accepts exact commit package when pin is supplied", { timeout: 30_000 }, async (t) => {
  if (!officialRoot) return t.skip("Set XAGT_PLUGIN_ROOT to the clean official pin for this gate");
  assert.ok(existsSync(join(officialRoot,"scripts","validate-submission.mjs")));
  const pin = spawnSync("git", ["-C", officialRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["-C", officialRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).stdout;
  assert.equal(pin,OFFICIAL_XAGT_PLUGIN_PIN);assert.equal(dirty,"");
  const scratch = await mkdtemp(join(tmpdir(), "s118-xagent-validate-"));
  const outDir = join(scratch, DEFAULT_SLUG);
  try {
    await buildPageChangePackage({
      repoRoot: root,
      commit: head(),
      outDir,
      reviewCommit: head(),
    });
    const sidecar = spawnSync(process.execPath, [join(root, "scripts/page-change-xagent-sidecar.mjs"), outDir], {
      env: { ...process.env, XAGT_PLUGIN_ROOT: officialRoot },
      encoding: "utf8",
      timeout: 20_000,
    });
    assert.equal(sidecar.status, 0, sidecar.stdout + sidecar.stderr);
    const report = JSON.parse(sidecar.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.officialPin, OFFICIAL_XAGT_PLUGIN_PIN);
    assert.equal(report.report.status, "pass");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

function gitAt(repo,args){const r=spawnSync('git',['-C',repo,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
async function fixtureRepo(t){const dir=await mkdtemp(join(tmpdir(),'xagent-hostile-'));t.after(()=>rm(dir,{recursive:true,force:true}));gitAt(dir,['init']);return dir;}
function commitFixture(dir){gitAt(dir,['add','--all']);gitAt(dir,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);return gitAt(dir,['rev-parse','HEAD']);}

test('review source cannot be relabelled and worktree preview cannot mint proof',async(t)=>{
 const scratch=await fixtureRepo(t);const outDir=join(scratch,DEFAULT_SLUG);
 for(const args of [{commit:head(),reviewCommit:'f'.repeat(40)},{worktree:true,reviewCommit:head()},{commit:head(),sourceRepository:'https://github.com/other/repo'},{commit:head(),apiBaseUrl:'https://example.com/$(command)'}]) {
  await assert.rejects(buildPageChangePackage({repoRoot:root,outDir,...args}));assert.equal(existsSync(outDir),false);
 }
});
test('existing output, source parent and symlink output never overwritten',async(t)=>{
 const scratch=await fixtureRepo(t);const out=join(scratch,DEFAULT_SLUG);await mkdir(out);await writeFile(join(out,'keep'),'unchanged');
 await assert.rejects(buildPageChangePackage({repoRoot:root,commit:head(),outDir:out}));assert.equal(await readFile(join(out,'keep'),'utf8'),'unchanged');
 await assert.rejects(buildPageChangePackage({repoRoot:root,commit:head(),outDir:root,slug:root.split('/').pop()}));
 const link=join(scratch,'link');await symlink(out,link);await assert.rejects(buildPageChangePackage({repoRoot:root,commit:head(),outDir:join(link,DEFAULT_SLUG)}));
});
test('commit mode rejects symlinks and nonportable encoded source paths',async(t)=>{
 const repo=await fixtureRepo(t);await writeFile(join(repo,'ok'),'data');await symlink('ok',join(repo,'link'));let pin=commitFixture(repo);
 assert.throws(()=>planPackageFiles(repo,{commit:pin}),/Non-regular/);await rm(join(repo,'link'));await writeFile(join(repo,'bad\\path'),'data');pin=commitFixture(repo);assert.throws(()=>planPackageFiles(repo,{commit:pin}),/Unsafe/);
});
test('unchanged commit builds deterministic manifests and verifies every source byte', {timeout:60000},async(t)=>{
 const scratch=await fixtureRepo(t),pin=head();const a=join(scratch,'a'),b=join(scratch,'b');await mkdir(a);await mkdir(b);
 const paths=[join(a,DEFAULT_SLUG),join(b,DEFAULT_SLUG)];
 for(const outDir of paths) await buildPageChangePackage({repoRoot:root,commit:pin,outDir});
 for(const name of ['SOURCE_MANIFEST.json','submission.json','SUBMISSION.md','verification/README.md'])assert.equal(await readFile(join(paths[0],name),'utf8'),await readFile(join(paths[1],name),'utf8'));
 const manifest=JSON.parse(await readFile(join(paths[0],'SOURCE_MANIFEST.json'),'utf8'));assert.equal(manifest.sourceCommit,pin);assert.equal(manifest.fullMerchantRunnable,false);
 for(const file of manifest.included)assert.equal(sha256(await readFile(join(paths[0],'source',file.path))),file.sha256,file.path);
});
test('sidecar detects a skip-worktree modification to the official validator',async(t)=>{
 if(!officialRoot)return t.skip('Official validator checkout not supplied');
 const scratch=await fixtureRepo(t),repo=join(scratch,'validator');const cloned=spawnSync('git',['clone','--quiet','--shared',officialRoot,repo],{encoding:'utf8'});assert.equal(cloned.status,0,cloned.stderr);
 gitAt(repo,['update-index','--skip-worktree','scripts/validate-submission.mjs']);await writeFile(join(repo,'scripts/validate-submission.mjs'),'throw new Error("untrusted validator executed");');
 assert.equal(gitAt(repo,['status','--porcelain']),'');
 const r=spawnSync(process.execPath,[join(root,'scripts/page-change-xagent-sidecar.mjs'),scratch],{env:{...process.env,XAGT_PLUGIN_ROOT:repo},encoding:'utf8'});assert.equal(r.status,2);assert.match(r.stderr,/missing, dirty, or not at the exact pin/);assert.doesNotMatch(r.stderr,/untrusted validator executed/);
});

test('local Git replacements cannot relabel archived source bytes',async(t)=>{
 const repo=await fixtureRepo(t);await writeFile(join(repo,'safe.mjs'),'export const value=1;');const original=commitFixture(repo);
 await writeFile(join(repo,'safe.mjs'),'export const value=2;');const replacement=commitFixture(repo);gitAt(repo,['replace',original,replacement]);
 assert.equal(gitAt(repo,['show',`${original}:safe.mjs`]),'export const value=2;');
 const plan=planPackageFiles(repo,{commit:original});assert.equal(plan.included[0].sha256,sha256(Buffer.from('export const value=1;')));
});
