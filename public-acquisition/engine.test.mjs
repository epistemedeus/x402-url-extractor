import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";

import { acquisitionIndexSkill, loadMachineAcquisition, mountMachineAcquisition } from "../machine-acquisition.mjs";
import { mountWellKnownSkills } from "../well-known-skills.mjs";
import {
  handlePublicAcquisitionRequest,
  inventoryArchive,
  loadPublicAcquisition,
  mountPublicAcquisition,
} from "./engine.mjs";
import { mountPublicAcquisitionIfPresent } from "./optional-mount.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(ROOT);
const BYTES = join(ROOT, "bytes");
const MANIFEST_PATH = join(ROOT, "manifest.json");
const NODE = process.execPath;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function response() {
  const headers = {};
  let status = 200;
  let body = Buffer.alloc(0);
  return {
    statusCode() { return status; },
    headers() { return headers; },
    body() { return body; },
    status(code) { status = code; return this; },
    set(name, value) {
      headers[String(name).toLowerCase()] = String(value);
      return this;
    },
    end(chunk) {
      if (chunk !== undefined) body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      return this;
    },
  };
}

function published() {
  return loadPublicAcquisition();
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

test("receiving manifest publishes the public archives and keeps draft claims false", () => {
  const loaded = published();
  assert.equal(loaded.order.length, 16);
  const composition = loaded.files.get("composition-route-knowledge/0.1.0/composition-route-knowledge-0.1.0.tgz");
  const retained = loaded.files.get("retained-task/0.1.0/retained-task-0.1.0.tar.gz");
  const l09 = loaded.files.get("l09-next-action/0.1.0/l09-next-action-0.1.0.tar.gz");
  assert.equal(composition.bytes.length, 66166);
  assert.equal(sha256(composition.bytes), "11d5a0e2df86282b6d4edbeab84b6d8ab5ccdb26b44364042cf76c9576c23817");
  assert.equal(retained.bytes.length, 107420);
  assert.equal(sha256(retained.bytes), "350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de");
  assert.equal(l09.bytes.length, 477108);
  assert.equal(sha256(l09.bytes), "23bf8574b37c485b4b99f2e15f9b77a3239d0b2308a9048c25e118425a7f63d0");
  const seller = loaded.files.get("seller-repair-external-consumer/0.2.0/seller-repair-external-consumer-0.2.0.tar.gz");
  assert.equal(seller.bytes.length, 30462);
  assert.equal(sha256(seller.bytes), "86e55a75f7e7e5c5ad188de8b20c64648f40c236b11981186b56abeb6d11350f");
  assert.equal(seller.asset.hostedAcquisitionVerified, false);
  assert.equal(seller.asset.paidLaunch, false);
  assert.equal(loaded.document.hostedAcquisitionVerified, false);
  assert.equal(loaded.document.productionHosted, false);
  assert.equal(loaded.document.sourceQualification, "unknown");
  assert.equal(loaded.document.privateGit, "unavailable");
  const provenance = JSON.parse(loaded.files.get("composition-route-knowledge/0.1.0/provenance.json").bytes.toString("utf8"));
  assert.equal(provenance.private, true);
  assert.equal(provenance.hostedAcquisitionVerified, false);
  assert.equal(provenance.publicationStatus, "candidate");
  const engine = readFileSync(join(ROOT, "engine.mjs"), "utf8");
  assert.doesNotMatch(engine, /l09-next-action|retained-task|composition-route-knowledge/);
  assert.doesNotMatch(engine, /\bfetch\(/);
});

test("mount serves exact bytes and refuses traversal without taking other routes", () => {
  const loaded = published();
  const ok = response();
  handlePublicAcquisitionRequest({
    method: "GET",
    path: "/.well-known/public-acquisition/assets/retained-task/0.1.0/retained-task-0.1.0.tar.gz",
    originalUrl: "/.well-known/public-acquisition/assets/retained-task/0.1.0/retained-task-0.1.0.tar.gz",
  }, ok, { published: loaded, publicUrl: "https://agents.samedaydesk.com" });
  assert.equal(ok.statusCode(), 200);
  assert.equal(ok.headers()["content-type"], "application/gzip");
  assert.equal(ok.headers()["content-length"], "107420");
  assert.equal(ok.headers()["cache-control"], "public, max-age=3600");
  assert.equal(sha256(ok.body()), "350629b7bf1a14b092d94e0c27579f2e05114bf7f2f05a33c33d32b4c68176de");
  assert.match(ok.headers().link, /agents\.samedaydesk\.com\/\.well-known\/public-acquisition\/assets\/retained-task\/0\.1\.0\/retained-task-0\.1\.0\.tar\.gz/);
  const head = response();
  handlePublicAcquisitionRequest({
    method: "HEAD",
    path: "/.well-known/public-acquisition/assets/l09-next-action/0.1.0/LICENSE",
    originalUrl: "/.well-known/public-acquisition/assets/l09-next-action/0.1.0/LICENSE",
  }, head, { published: loaded, publicUrl: "https://agents.samedaydesk.com" });
  assert.equal(head.statusCode(), 200);
  assert.equal(head.body().length, 0);
  assert.equal(head.headers()["content-length"], "1395");
  const index = response();
  handlePublicAcquisitionRequest({
    method: "GET",
    path: "/.well-known/public-acquisition/index.json",
    originalUrl: "/.well-known/public-acquisition/index.json",
  }, index, { published: loaded, publicUrl: "https://agents.samedaydesk.com" });
  const document = JSON.parse(index.body().toString("utf8"));
  assert.equal(document.productionHosted, false);
  assert.equal(document.hostedAcquisitionVerified, false);
  assert.equal(document.primaryOrigin, "https://neomorphic.io");
  assert.equal(document.primaryRouteRemainsAvailable, true);
  assert.equal(document.alternateOriginStatus, "configured-not-verified");
  assert.equal(document.assets.some((asset) => asset.originalUrl === "https://neomorphic.io/downloads/l09-next-action/0.1.0/l09-next-action-0.1.0.tar.gz"), true);
  for (const path of [
    "/.well-known/public-acquisition/assets/../../server.js",
    "/.well-known/public-acquisition/assets/%2e%2e/server.js",
    "/.well-known/public-acquisition/assets/retained-task/0.1.0/missing.tar.gz",
    "/.well-known/public-acquisition/assets/retained-task/0.1.0/",
  ]) {
    const blocked = response();
    handlePublicAcquisitionRequest({ method: "GET", path, originalUrl: path }, blocked, { published: loaded });
    assert.equal(blocked.statusCode(), 404, path);
    assert.equal(blocked.body().toString("utf8").includes("PAY_TO"), false);
    assert.equal(blocked.body().toString("utf8").includes("secret"), false);
  }
  assert.equal(handlePublicAcquisitionRequest({
    method: "GET",
    path: "/extract",
    originalUrl: "/extract",
  }, response(), { published: loaded }), false);
});

test("changed, missing, wrong-length, extra, private, and symlink bytes are refused", () => {
  const root = mkdtempSync(join(tmpdir(), "public-acquisition-reject-"));
  const bytesRoot = join(root, "bytes");
  cpSync(BYTES, bytesRoot, { recursive: true });
  const flipped = join(bytesRoot, "composition-route-knowledge/0.1.0/composition-route-knowledge-0.1.0.tgz");
  const original = readFileSync(flipped);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 0xff;
  writeFileSync(flipped, tampered);
  assert.throws(() => loadPublicAcquisition({ bytesRoot }), /changed bytes/);

  writeFileSync(flipped, original);
  rmSync(join(bytesRoot, "retained-task/0.1.0/SOURCE-NOTICE.txt"));
  assert.throws(() => loadPublicAcquisition({ bytesRoot }), /missing asset/);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const wrong = structuredClone(manifest);
  const license = wrong.assets.find((asset) => asset.relativePath === "l09-next-action/0.1.0/LICENSE");
  license.bytes += 1;
  assert.throws(() => loadPublicAcquisition({ manifest: wrong, manifestPath: MANIFEST_PATH }), /wrong byte length/);

  const extraRoot = mkdtempSync(join(tmpdir(), "public-acquisition-extra-"));
  const extraBytes = join(extraRoot, "bytes");
  cpSync(BYTES, extraBytes, { recursive: true });
  writeFileSync(join(extraBytes, "l09-next-action/0.1.0/extra.txt"), "added\n");
  assert.throws(() => loadPublicAcquisition({ bytesRoot: extraBytes }), /undeclared file/);

  const privateRoot = mkdtempSync(join(tmpdir(), "public-acquisition-private-"));
  const privateBytes = join(privateRoot, "bytes");
  cpSync(BYTES, privateBytes, { recursive: true });
  writeFileSync(join(privateBytes, "retained-task/0.1.0/id_rsa"), "not-a-key\n");
  assert.throws(() => loadPublicAcquisition({ bytesRoot: privateBytes }), /private addition/);

  const linkRoot = mkdtempSync(join(tmpdir(), "public-acquisition-link-"));
  const linkBytes = join(linkRoot, "bytes");
  cpSync(BYTES, linkBytes, { recursive: true });
  symlinkSync(join(linkBytes, "retained-task/0.1.0/LICENSE"), join(linkBytes, "retained-task/0.1.0/LICENSE-link"));
  assert.throws(() => loadPublicAcquisition({ bytesRoot: linkBytes }), /symlink/);
});

test("unsafe archive members, private prefixes, and arbitrary upstreams are refused", () => {
  const crafted = spawnSync("python3", ["-c", `
import io, tarfile, gzip
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode="w") as tf:
    info = tarfile.TarInfo("escape/link")
    info.type = tarfile.SYMTYPE
    info.linkname = "../server.js"
    tf.addfile(info)
sys_bytes = gzip.compress(raw.getvalue())
open("/tmp/public-acquisition-symlink.tgz", "wb").write(sys_bytes)
`], { encoding: "utf8" });
  assert.equal(crafted.status, 0, crafted.stderr);
  assert.throws(() => inventoryArchive(readFileSync("/tmp/public-acquisition-symlink.tgz")), /unsupported tar member type/);

  const privateCraft = spawnSync("python3", ["-c", `
import io, tarfile, gzip
raw = io.BytesIO()
payload = b"no\\n"
with tarfile.open(fileobj=raw, mode="w") as tf:
    info = tarfile.TarInfo("pack/services/earned-work/secret.txt")
    info.size = len(payload)
    tf.addfile(info, io.BytesIO(payload))
open("/tmp/public-acquisition-private.tgz", "wb").write(gzip.compress(raw.getvalue()))
`], { encoding: "utf8" });
  assert.equal(privateCraft.status, 0, privateCraft.stderr);
  const privateBytes = readFileSync("/tmp/public-acquisition-private.tgz");
  const members = inventoryArchive(privateBytes);
  const inventory = {
    schema: "samedaydesk.public-acquisition.members.v1",
    id: "fixture-pack",
    version: "0.1.0",
    archiveSha256: sha256(privateBytes),
    memberCount: members.length,
    members,
  };
  const inventoryDir = mkdtempSync(join(tmpdir(), "public-acquisition-inventory-"));
  mkdirSync(join(inventoryDir, "inventories"));
  const inventoryPath = join(inventoryDir, "inventories/fixture-pack-0.1.0.json");
  writeFileSync(inventoryPath, `${JSON.stringify(inventory)}\n`);
  const bytesRoot = join(inventoryDir, "bytes/fixture-pack/0.1.0");
  mkdirSync(bytesRoot, { recursive: true });
  writeFileSync(join(bytesRoot, "fixture-pack-0.1.0.tar.gz"), privateBytes);
  const manifestPath = join(inventoryDir, "manifest.json");
  const manifest = {
    schema: "samedaydesk.public-acquisition.receiving.v1",
    draft: true,
    productionHosted: false,
    hostedAcquisitionVerified: false,
    deploymentReadback: "untested",
    primaryOrigin: "https://neomorphic.io",
    primaryRouteRemainsAvailable: true,
    allowedOriginalHosts: ["neomorphic.io"],
    runtimeDownloadFallback: false,
    privateGit: "unavailable",
    paidLaunch: false,
    measuredSavings: false,
    independentDemand: false,
    sourceQualification: "unknown",
    assets: [{
      id: "fixture-pack",
      version: "0.1.0",
      role: "archive",
      filename: "fixture-pack-0.1.0.tar.gz",
      relativePath: "fixture-pack/0.1.0/fixture-pack-0.1.0.tar.gz",
      bytes: privateBytes.length,
      sha256: sha256(privateBytes),
      mediaType: "application/gzip",
      originalUrl: "https://neomorphic.io/downloads/fixture-pack/0.1.0/fixture-pack-0.1.0.tar.gz",
      licenseId: "MIT",
      attribution: "fixture",
      sourceQualification: "unknown",
      privateGit: "unavailable",
      hostedAcquisitionVerified: false,
      paidLaunch: false,
      measuredSavings: false,
      independentDemand: false,
      forbiddenPathPrefixes: ["services/earned-work/"],
      inventory: {
        path: "inventories/fixture-pack-0.1.0.json",
        fileSha256: sha256(readFileSync(inventoryPath)),
        memberCount: members.length,
      },
    }],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => loadPublicAcquisition({ manifestPath, bytesRoot: join(inventoryDir, "bytes") }), /private member/);

  const upstream = structuredClone(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")));
  upstream.assets[0].originalUrl = "https://example.test/downloads/l09-next-action/0.1.0/l09-next-action-0.1.0.tar.gz";
  assert.throws(() => loadPublicAcquisition({ manifest: upstream, manifestPath: MANIFEST_PATH }), /not allowlisted|does not match/);
  upstream.assets[0].originalUrl = "https://neomorphic.io/downloads/l09-next-action/0.1.0/l09-next-action-0.1.0.tar.gz";
  upstream.assets[0].runtimeDownload = true;
  assert.throws(() => loadPublicAcquisition({ manifest: upstream, manifestPath: MANIFEST_PATH }), /runtime download/);
  delete upstream.assets[0].runtimeDownload;
  upstream.assets[0].sourceQualification = "official";
  assert.throws(() => loadPublicAcquisition({ manifest: upstream, manifestPath: MANIFEST_PATH }), /source qualification/);
});

test("existing skill mount stays useful when this adapter is absent", async () => {
  const app = express();
  app.disable("x-powered-by");
  mountMachineAcquisition(app, { publicUrl: "https://agents.samedaydesk.com" });
  mountWellKnownSkills(app, {
    publicUrl: "https://agents.samedaydesk.com",
    extraIndexSkills: [acquisitionIndexSkill()],
  });
  const absent = await mountPublicAcquisitionIfPresent(app, { publicUrl: "https://agents.samedaydesk.com" }, join(ROOT, "missing-engine.mjs"));
  assert.equal(absent.mounted, false);
  assert.equal(absent.reason, "absent");
  const server = await listen(app);
  const port = server.address().port;
  const skill = await fetch(`http://127.0.0.1:${port}/.well-known/skills/route-lock-receipt/SKILL.md`);
  assert.equal(skill.status, 200);
  assert.match(await skill.text(), /route-lock-receipt/);
  const missing = await fetch(`http://127.0.0.1:${port}/.well-known/public-acquisition/index.json`);
  assert.equal(missing.status, 404);
  server.close();
});

test("adapter mount leaves the skill and a later paid route reachable", async () => {
  const app = express();
  app.disable("x-powered-by");
  mountMachineAcquisition(app, { publicUrl: "https://agents.samedaydesk.com" });
  mountWellKnownSkills(app, {
    publicUrl: "https://agents.samedaydesk.com",
    extraIndexSkills: [acquisitionIndexSkill()],
  });
  mountPublicAcquisition(app, { publicUrl: "https://agents.samedaydesk.com" });
  app.get("/extract", (_req, res) => {
    res.status(402).json({ charged: false, route: "GET /extract" });
  });
  const server = await listen(app);
  const port = server.address().port;
  const skill = await fetch(`http://127.0.0.1:${port}/.well-known/skills/route-lock-receipt/SKILL.md`);
  assert.equal(skill.status, 200);
  const archive = await fetch(`http://127.0.0.1:${port}/.well-known/public-acquisition/assets/composition-route-knowledge/0.1.0/composition-route-knowledge-0.1.0.tgz`);
  const bytes = Buffer.from(await archive.arrayBuffer());
  assert.equal(archive.status, 200);
  assert.equal(bytes.length, 66166);
  assert.equal(sha256(bytes), "11d5a0e2df86282b6d4edbeab84b6d8ab5ccdb26b44364042cf76c9576c23817");
  const paid = await fetch(`http://127.0.0.1:${port}/extract`);
  assert.equal(paid.status, 402);
  assert.equal((await paid.json()).charged, false);
  server.close();
});

test("old route-lock descriptors are unchanged and Root mounts only the optional public adapter", () => {
  const bundle = loadMachineAcquisition();
  assert.equal(bundle.files.get("references/manifest.json").toString("utf8").includes("\"hostedAcquisitionVerified\": false"), true);
  const server = readFileSync(join(REPO, "server.js"), "utf8");
  assert.match(server, /mountPublicAcquisitionIfPresent/);
  assert.match(server, /if \(existsSync\(publicAcquisitionOptional\)\)/);
  assert.match(server, /extraIndexSkills: \[acquisitionIndexSkill\(\{ recipient: PAY_TO \}\)\]/);
  const patch = readFileSync(join(ROOT, "root-mount.patch"), "utf8");
  assert.match(patch, /mountPublicAcquisitionIfPresent/);
  assert.doesNotMatch(patch, /priceToAtomic|EXTRACT_PRICE|PAY_TO =/);
});

test("cold node and python httpx clients unpack the mount and run the declared commands", async () => {
  const child = spawn(NODE, [join(ROOT, "serve-receiving.mjs")], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mount did not start")), 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match = stdout.match(/public-acquisition-mount (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", (code) => reject(new Error(`mount exited ${code}`)));
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    const nodeRun = spawnSync(NODE, [join(ROOT, "cold-acquire.mjs"), "--proof", "loopback", "--base", base], { encoding: "utf8" });
    assert.equal(nodeRun.status, 0, nodeRun.stderr);
    const nodeProfile = JSON.parse(nodeRun.stdout);
    assert.equal(nodeProfile.proofClass, "loopback");
    assert.equal(nodeProfile.productionAcceptance, false);
    assert.equal(nodeProfile.results.length, 4);
    assert.equal(nodeProfile.results[3].id, "seller-repair-external-consumer");
    assert.equal(nodeProfile.results[1].id, "retained-task");
    assert.equal(nodeProfile.hermes.invoked, false);
    const pythonRun = spawnSync("python3", [join(ROOT, "cold-httpx.py"), "--proof", "loopback", "--base", base], { encoding: "utf8" });
    assert.equal(pythonRun.status, 0, pythonRun.stderr);
    const pythonProfile = JSON.parse(pythonRun.stdout);
    assert.equal(pythonProfile.client, "python-httpx");
    assert.equal(pythonProfile.proofClass, "loopback");
    assert.equal(pythonProfile.productionAcceptance, false);
    assert.deepEqual(pythonProfile.results.map((result) => result.sha256), nodeProfile.results.map((result) => result.sha256));
    assert.equal(pythonProfile.hermes.gitCheckout, false);
    writeFileSync(join(ROOT, "loopback-profile.json"), `${JSON.stringify({ node: nodeProfile, python: pythonProfile }, null, 2)}\n`);
  } finally {
    child.kill("SIGTERM");
  }
});
