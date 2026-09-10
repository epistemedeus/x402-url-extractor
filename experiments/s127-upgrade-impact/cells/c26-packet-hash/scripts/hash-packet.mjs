#!/usr/bin/env node
/**
 * Cell-local CLI: print packet / payload / decision sha256 for a JSON file.
 * Offline. Does not post, pay, or invent a clock.
 */
import { basename } from "node:path";
import { hashPacketFile } from "../packet-hash.mjs";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: node scripts/hash-packet.mjs <packet.json>\n");
  process.exit(2);
}

const result = hashPacketFile(path);
if (!result.ok) {
  process.stderr.write(`${result.code}: ${result.message}\n`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify(
    {
      file: basename(path),
      label: result.label,
      evidenceClass: result.evidenceClass,
      nextAction: result.nextAction,
      packetHash: result.packetHash,
      payloadHash: result.payloadHash,
      decisionHash: result.decisionHash,
      sourceSha256: result.sourceSha256,
    },
    null,
    2,
  )}\n`,
);
