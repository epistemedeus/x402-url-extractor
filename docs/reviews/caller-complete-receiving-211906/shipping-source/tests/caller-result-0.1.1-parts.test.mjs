import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const materializer = path.join(repo, "scripts/materialize-caller-result-0.1.1.mjs");
const sourceParts = path.join(repo, "scripts/fixtures/samedaydesk-caller-result-0.1.1.tar.gz.b64.d");
const ARCHIVE_SHA256 = "693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3";
const ARCHIVE_BYTES = 32421;
const SEALED_010 = "3c134598697aadb038a98bfee4ad6e82472df34d3fa325e19507a33ed5dc974b";

function run(payload, root) {
  return spawnSync(process.execPath, [materializer, "--root", root, "--payload", payload], { encoding: "utf8" });
}

function copyParts() {
  const dir = mkdtempSync(path.join(tmpdir(), "caller-parts-"));
  cpSync(sourceParts, dir, { recursive: true });
  return dir;
}

function archivePath(root) {
  return path.join(root, "public/downloads/samedaydesk-caller-result/0.1.1/samedaydesk-caller-result-0.1.1.tar.gz");
}

test("six parts, including wrapped part 03, materialize the merchant archive", () => {
  const payload = copyParts();
  const wrapped = readFileSync(path.join(payload, "01"), "utf8");
  writeFileSync(path.join(payload, "01"), wrapped.replace(/(.{64})/g, "$1\n"));
  const root = mkdtempSync(path.join(tmpdir(), "caller-root-"));
  const sealed = path.join(root, "public/downloads/samedaydesk-caller-result/0.1.0/samedaydesk-caller-result-0.1.0.tar.gz");
  mkdirSync(path.dirname(sealed), { recursive: true });
  writeFileSync(sealed, Buffer.from("sealed-0.1.0"));
  assert.equal(existsSync(archivePath(root)), false);
  try {
    const first = run(payload, root);
    assert.equal(first.status, 0, first.stderr);
    const bytes = readFileSync(archivePath(root));
    assert.equal(bytes.length, ARCHIVE_BYTES);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), ARCHIVE_SHA256);
    assert.equal(readFileSync(sealed, "utf8"), "sealed-0.1.0");
    const again = run(payload, root);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(createHash("sha256").update(readFileSync(archivePath(root))).digest("hex"), ARCHIVE_SHA256);
    writeFileSync(archivePath(root), Buffer.from("different"));
    const refused = run(payload, root);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to rewrite/);
    assert.equal(readFileSync(archivePath(root), "utf8"), "different");
    assert.equal(SEALED_010.length, 64);
  } finally {
    rmSync(payload, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("unexpected numeric, non-numeric, and whitespace-only extra parts are refused", () => {
  for (const [name, body] of [
    ["0300", "AAAA"],
    ["06", "\n\n"],
    ["notes.txt", "ignore-me"],
  ]) {
    const payload = copyParts();
    const root = mkdtempSync(path.join(tmpdir(), "caller-extra-"));
    writeFileSync(path.join(payload, name), body);
    try {
      const result = run(payload, root);
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, new RegExp(`unexpected parts ${name.replace(".", "\\.")}`));
      assert.equal(existsSync(archivePath(root)), false);
    } finally {
      rmSync(payload, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a missing part is refused before a length check", () => {
  const payload = copyParts();
  const root = mkdtempSync(path.join(tmpdir(), "caller-missing-"));
  rmSync(path.join(payload, "03"));
  try {
    const result = run(payload, root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing parts 03/);
    assert.equal(existsSync(archivePath(root)), false);
  } finally {
    rmSync(payload, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed and empty parts are refused before a length check", () => {
  const malformed = copyParts();
  const empty = copyParts();
  const rootA = mkdtempSync(path.join(tmpdir(), "caller-bad-"));
  const rootB = mkdtempSync(path.join(tmpdir(), "caller-empty-"));
  writeFileSync(path.join(malformed, "00"), "!!!!not-base64!!!!");
  writeFileSync(path.join(empty, "02"), " \n\t");
  try {
    const bad = run(malformed, rootA);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /not valid base64/);
    assert.equal(existsSync(archivePath(rootA)), false);
    const blank = run(empty, rootB);
    assert.equal(blank.status, 1);
    assert.match(blank.stderr, /part 02 is empty/);
    assert.equal(existsSync(archivePath(rootB)), false);
  } finally {
    rmSync(malformed, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
