#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { PACK_ROOT, SYNTHETIC_ROOT, listCaseIds, loadSyntheticCase } from "../lib/cases.mjs";
import { FIXTURE_CLOCK } from "../lib/constants.mjs";
import { posixRel, walkFiles } from "../lib/fs-utils.mjs";
import { sha256Hex } from "../lib/hash.mjs";
import { composePacket, stubImpl } from "../lib/packet.mjs";
import { buildPriorDocument } from "../lib/prior.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const priorPayload = {
  dependency: {
    name: "demo-widget",
    oldVersion: "1.0.0",
    newVersion: "1.0.0",
  },
  summary: { nextAction: "no_action" },
  label: "synthetic",
  notes: "Immutable synthetic prior before the 1.0.0 -> 2.0.0 comparison. Not live-capture.",
};

const priorDoc = buildPriorDocument({
  createdAt: "2026-08-01T00:00:00.000Z",
  sequence: 1,
  payload: priorPayload,
});

const priorDir = join(SYNTHETIC_ROOT, "priors");
mkdirSync(priorDir, { recursive: true });
const priorPath = join(priorDir, "removed-export-used.seq-1.json");
writeFileSync(priorPath, pretty(priorDoc));

const goldensDir = join(SYNTHETIC_ROOT, "goldens");
mkdirSync(goldensDir, { recursive: true });

const impl = stubImpl();
const written = [];
for (const id of listCaseIds()) {
  const loaded = loadSyntheticCase(id);
  const packet = composePacket(loaded.input, impl);
  if (packet.ok === false) {
    throw new Error(`compose failed for ${id}: ${packet.code} ${packet.message}`);
  }
  const outPath = join(goldensDir, `${id}.packet.json`);
  writeFileSync(outPath, pretty(packet));
  written.push({ id, outPath, nextAction: packet.summary.nextAction });
}

const files = {};
for (const file of walkFiles(SYNTHETIC_ROOT)) {
  if (file.endsWith("/PROVENANCE.json")) continue;
  const rel = posixRel(PACK_ROOT, file);
  files[rel] = {
    sha256: sha256Hex(readFileSync(file)),
    label: "synthetic",
    coverage: "full",
  };
}

const provenance = {
  label: "synthetic",
  capturedAtUtc: FIXTURE_CLOCK,
  evidenceClassDefault: "synthetic",
  liveCapture: false,
  paidDemand: false,
  notes: "Authored synthetic fixtures and goldens. Not live-capture. Not paid demand. Assignment spend $0.",
  originalUrls: {},
  files,
  goldens: written.map((row) => ({
    id: row.id,
    path: posixRel(PACK_ROOT, row.outPath),
    nextAction: row.nextAction,
  })),
};

writeFileSync(join(SYNTHETIC_ROOT, "PROVENANCE.json"), pretty(provenance));

writeFileSync(
  join(cellRoot, "receipts", "emit-goldens.json"),
  pretty({
    clock: FIXTURE_CLOCK,
    packRoot: PACK_ROOT,
    priorPath: posixRel(PACK_ROOT, priorPath),
    priorSha256: priorDoc.sha256,
    goldens: written.map((row) => ({
      id: row.id,
      path: posixRel(PACK_ROOT, row.outPath),
      nextAction: row.nextAction,
    })),
  }),
);

console.log(JSON.stringify({ ok: true, goldens: written.map((row) => row.id), priorSha256: priorDoc.sha256 }, null, 2));
