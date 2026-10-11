#!/usr/bin/env node
// Places the caller 0.1.1 archive into the public download directory before
// Astro copies public/ into dist/. The bytes are the merchant archive.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVE_SHA256 = "693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3";
const ARCHIVE_BYTES = 32421;
const ARCHIVE_NAME = "samedaydesk-caller-result-0.1.1.tar.gz";
const PARTS = ["00", "01", "02", "03", "04", "05"];

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function readEncoded(payload) {
  const info = statSync(payload);
  if (info.isDirectory()) {
    const names = readdirSync(payload).sort();
    const unexpected = names.filter((name) => !PARTS.includes(name));
    if (unexpected.length > 0) fail(`caller archive payload ${payload} has unexpected parts ${unexpected.join(",")}`);
    const missing = PARTS.filter((name) => !names.includes(name));
    if (missing.length > 0) fail(`caller archive payload ${payload} is missing parts ${missing.join(",")}`);
    return PARTS.map((name) => {
      const text = readFileSync(path.join(payload, name), "utf8");
      if (text.replace(/\s+/g, "").length === 0) fail(`caller archive part ${name} is empty`);
      return text;
    }).join("");
  }
  if (!info.isFile()) fail(`caller archive payload ${payload} is not a file or directory`);
  return readFileSync(payload, "utf8");
}

function decodePayload(text) {
  const encoded = text.replace(/\s+/g, "");
  if (encoded.length === 0) fail("caller archive payload is empty");
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    fail("caller archive payload is not valid base64");
  }
  return Buffer.from(encoded, "base64");
}

const root = path.resolve(arg("--root") || repo);
const payload = path.resolve(arg("--payload") || path.join(here, "fixtures", `${ARCHIVE_NAME}.b64.d`));
const target = path.join(root, "public/downloads/samedaydesk-caller-result/0.1.1", ARCHIVE_NAME);
const bytes = decodePayload(readEncoded(payload));
if (bytes.length !== ARCHIVE_BYTES) fail(`caller archive length ${bytes.length} is not ${ARCHIVE_BYTES}`);
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== ARCHIVE_SHA256) fail(`caller archive sha256 ${sha256} is not ${ARCHIVE_SHA256}`);
mkdirSync(path.dirname(target), { recursive: true });
if (existsSync(target)) {
  const current = readFileSync(target);
  if (current.length !== bytes.length || !current.equals(bytes)) fail(`refusing to rewrite ${target}`);
} else {
  writeFileSync(target, bytes);
}
process.stdout.write(`${JSON.stringify({ path: target, bytes: bytes.length, sha256 })}\n`);
