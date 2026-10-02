import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPublicAcquisition } from "../../../../public-acquisition/engine.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, "..");
const packer = path.join(pkg, "export/pack.mjs");
const committed = path.join(pkg, "export/public");

function unpack(archive, dest) {
  const result = spawnSync("tar", ["-xzf", archive, "-C", dest], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

test("two cold consumers accept the public fixture and reject the seeded controls", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "useful-export-"));
  const packed = spawnSync(process.execPath, [packer, dir], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const fresh = JSON.parse(packed.stdout);
  const loaded = loadPublicAcquisition({
    manifestPath: path.join(dir, "manifest.json"),
    bytesRoot: path.join(dir, "bytes"),
  });
  assert.equal(loaded.document.draft, true);
  assert.equal(loaded.document.hostedAcquisitionVerified, false);
  assert.equal(loaded.document.independentDemand, false);
  const archive = loaded.files.get("useful-economics-100290/0.1.0/useful-economics-100290-0.1.0.tar.gz");
  assert.equal(archive.bytes.length > 0, true);
  const workA = path.join(dir, "consumer-a");
  const workB = path.join(dir, "consumer-b");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(workA);
  mkdirSync(workB);
  unpack(path.join(dir, "bytes/useful-economics-100290/0.1.0/useful-economics-100290-0.1.0.tar.gz"), workA);
  unpack(path.join(dir, "bytes/useful-economics-100290/0.1.0/useful-economics-100290-0.1.0.tar.gz"), workB);
  const clean = { ...process.env };
  delete clean.COMMERCE_DATA_DIR;
  delete clean.COMMERCE_INTERNAL_TOKEN;
  delete clean.USEFUL_RESULT_GRANT;
  const accepted = spawnSync(process.execPath, ["bin/cold-consumer.mjs", "accepted"], { cwd: workA, encoding: "utf8", env: clean });
  assert.equal(accepted.status, 0, `${accepted.stdout}\n${accepted.stderr}`);
  const acceptedBody = JSON.parse(accepted.stdout);
  assert.equal(acceptedBody.recognizedRevenueAtomic, "0");
  assert.equal(acceptedBody.historicalCountedInBreakeven, false);
  assert.equal(acceptedBody.demandEstablished, false);
  assert.equal(acceptedBody.useful.includes("agreed_negative"), true);
  const rejected = spawnSync(process.execPath, ["bin/cold-consumer.mjs", "reject", "fixtures/seeded-http200.json"], {
    cwd: workB,
    encoding: "utf8",
    env: clean,
  });
  assert.equal(rejected.status, 2, `${rejected.stdout}\n${rejected.stderr}`);
  assert.match(rejected.stderr, /http200_directive_refused/);
  const margin = spawnSync(process.execPath, ["bin/cold-consumer.mjs", "reject", "fixtures/seeded-margin.json"], {
    cwd: workB,
    encoding: "utf8",
    env: clean,
  });
  assert.equal(margin.status, 2, margin.stderr);
  assert.match(margin.stderr, /historical_not_margin/);
  const leaked = spawnSync(process.execPath, ["bin/cold-consumer.mjs", "accepted"], {
    cwd: workA,
    encoding: "utf8",
    env: { ...clean, COMMERCE_DATA_DIR: dir, COMMERCE_INTERNAL_TOKEN: "not-a-real-token", USEFUL_RESULT_GRANT: "ab".repeat(32) },
  });
  assert.equal(leaked.status, 2, leaked.stdout);
  assert.match(leaked.stderr, /provider_env_refused/);
  const committedManifest = JSON.parse(await readFile(path.join(committed, "manifest.json"), "utf8"));
  const committedArchive = committedManifest.assets.find((asset) => asset.role === "archive");
  assert.equal(committedArchive.sha256, fresh.archiveSha256);
  const committedLoad = loadPublicAcquisition({
    manifestPath: path.join(committed, "manifest.json"),
    bytesRoot: path.join(committed, "bytes"),
  });
  assert.equal(committedLoad.document.assets.length, 4);
  await rm(dir, { recursive: true, force: true });
});
