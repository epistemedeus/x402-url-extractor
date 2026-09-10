/**
 * Materialize key-order / replay-identity fixtures from base packets.
 * Writes only under cells/c26-packet-hash/. Offline. No network.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareReplay,
  hashPacket,
  hashPacketFile,
  reverseKeys,
  sha256Hex,
  stableStringify,
} from "../packet-hash.mjs";

const cellRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesRoot = join(cellRoot, "fixtures");
const packetsDir = join(fixturesRoot, "packets");
const keyOrderDir = join(fixturesRoot, "key-order");
const depDir = join(fixturesRoot, "synthetic-dep");

const CLOCK = "2026-09-10T09:54:59.000Z";
const CLOCK2 = "2026-09-10T12:00:00.000Z";

function shaFile(name) {
  return sha256Hex(readFileSync(join(depDir, name)));
}

const SHA_V1 = shaFile("v1.0.0.js");
const SHA_V2_PARSE_REMOVED = shaFile("v2.0.0-parse-removed.js");
const SHA_V2_EXTRA_REMOVED = shaFile("v2.0.0-extra-removed.js");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function writeCanonicalFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function provenance(path, sha, retrievedAt = CLOCK) {
  return {
    path,
    retrievedAt,
    contentSha256: sha,
    coverage: "complete",
    label: "synthetic",
  };
}

function caller(slug) {
  return {
    manifestPath: `cells/c26-packet-hash/fixtures/callers/${slug}/package.json`,
    lockfilePath: `cells/c26-packet-hash/fixtures/callers/${slug}/package-lock.json`,
    sourceRoots: [`cells/c26-packet-hash/fixtures/callers/${slug}/src`],
    evidenceClass: "fixture",
  };
}

function limitations(extra = []) {
  return [
    "synthetic fixture; not live-capture",
    "no full TS analysis; no runtime exec",
    ...extra,
  ];
}

const bases = {
  "action-used-removed": {
    schema: "s127.upgrade-impact.packet.v1",
    createdAt: CLOCK,
    clock: CLOCK,
    caller: caller("used-removed"),
    dependency: {
      name: "s127-hash-demo",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      resolvedOld: "1.0.0",
      resolvedNew: "2.0.0",
    },
    provenance: [
      provenance("cells/c26-packet-hash/fixtures/synthetic-dep/v1.0.0.js", SHA_V1),
      provenance(
        "cells/c26-packet-hash/fixtures/synthetic-dep/v2.0.0-parse-removed.js",
        SHA_V2_PARSE_REMOVED,
      ),
    ],
    usage: {
      imports: [{ from: "s127-hash-demo", names: ["parse"], dynamicImport: false }],
      dynamicImport: false,
      coverage: "complete",
    },
    exportDiff: {
      added: ["compat"],
      removed: ["parse"],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "parse",
        used: true,
        changeKind: "removed",
        decision: "action",
        rationale: "used export was removed",
      },
      {
        symbol: "compat",
        used: false,
        changeKind: "added",
        decision: "no_action",
        rationale: "unused export change is not a caller defect",
      },
    ],
    summary: {
      nextAction: "action",
      unknownReasons: [],
      unusedChanges: ["compat"],
      actionableChanges: ["parse"],
    },
    prior: null,
    limitations: limitations(),
  },
  "no-action-unused": {
    schema: "s127.upgrade-impact.packet.v1",
    createdAt: CLOCK,
    clock: CLOCK,
    caller: caller("unused-removed"),
    dependency: {
      name: "s127-hash-demo",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      resolvedOld: "1.0.0",
      resolvedNew: "2.0.0",
    },
    provenance: [
      provenance("cells/c26-packet-hash/fixtures/synthetic-dep/v1.0.0.js", SHA_V1),
      provenance(
        "cells/c26-packet-hash/fixtures/synthetic-dep/v2.0.0-extra-removed.js",
        SHA_V2_EXTRA_REMOVED,
      ),
    ],
    usage: {
      imports: [{ from: "s127-hash-demo", names: ["parse"], dynamicImport: false }],
      dynamicImport: false,
      coverage: "complete",
    },
    exportDiff: {
      added: [],
      removed: ["extra"],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "parse",
        used: true,
        changeKind: "unchanged",
        decision: "no_action",
        rationale: "used export is unchanged; a newer version is not itself a break",
      },
      {
        symbol: "extra",
        used: false,
        changeKind: "removed",
        decision: "no_action",
        rationale: "unused export change is not a caller defect",
      },
    ],
    summary: {
      nextAction: "no_action",
      unknownReasons: [],
      unusedChanges: ["extra"],
      actionableChanges: [],
    },
    prior: null,
    limitations: limitations(),
  },
  "unknown-dynamic": {
    schema: "s127.upgrade-impact.packet.v1",
    createdAt: CLOCK,
    clock: CLOCK,
    caller: caller("dynamic-import"),
    dependency: {
      name: "s127-hash-demo",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
      resolvedOld: "1.0.0",
      resolvedNew: "2.0.0",
    },
    provenance: [
      provenance("cells/c26-packet-hash/fixtures/synthetic-dep/v1.0.0.js", SHA_V1),
      provenance(
        "cells/c26-packet-hash/fixtures/synthetic-dep/v2.0.0-parse-removed.js",
        SHA_V2_PARSE_REMOVED,
      ),
    ],
    usage: {
      imports: [{ from: "s127-hash-demo", names: ["parse"], dynamicImport: true }],
      dynamicImport: true,
      coverage: "complete",
    },
    exportDiff: {
      added: [],
      removed: ["parse"],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "parse",
        used: true,
        changeKind: "removed",
        decision: "unknown",
        rationale: "dynamic import of package ⇒ unknown for that surface",
        dynamicImport: true,
      },
    ],
    summary: {
      nextAction: "unknown",
      unknownReasons: ["dynamic_import:parse"],
      unusedChanges: [],
      actionableChanges: [],
    },
    prior: null,
    limitations: limitations(["dynamic import of package ⇒ unknown for that surface"]),
  },
  "same-version-noop": {
    schema: "s127.upgrade-impact.packet.v1",
    createdAt: CLOCK,
    clock: CLOCK,
    caller: caller("same-version"),
    dependency: {
      name: "s127-hash-demo",
      oldVersion: "1.0.0",
      newVersion: "1.0.0",
      resolvedOld: "1.0.0",
      resolvedNew: "1.0.0",
    },
    provenance: [
      provenance("cells/c26-packet-hash/fixtures/synthetic-dep/v1.0.0.js", SHA_V1),
      provenance("cells/c26-packet-hash/fixtures/synthetic-dep/v1.0.0.js", SHA_V1),
    ],
    usage: {
      imports: [{ from: "s127-hash-demo", names: ["parse"], dynamicImport: false }],
      dynamicImport: false,
      coverage: "complete",
    },
    exportDiff: {
      added: [],
      removed: [],
      renamed: [],
      signatureChanged: [],
      coverage: "complete",
    },
    bindings: [
      {
        symbol: "parse",
        used: true,
        changeKind: "unchanged",
        decision: "no_action",
        rationale: "same-version/no-op is not an upgrade impact",
      },
    ],
    summary: {
      nextAction: "no_action",
      unknownReasons: [],
      unusedChanges: [],
      actionableChanges: [],
    },
    prior: null,
    limitations: limitations(["same-version/no-op ⇒ no_action"]),
  },
};

mkdirSync(packetsDir, { recursive: true });
mkdirSync(keyOrderDir, { recursive: true });

const simple = { a: 1, b: 2, nested: { m: 8, z: 9 } };
writeCanonicalFile(join(keyOrderDir, "simple-forward.json"), simple);
writeCanonicalFile(join(keyOrderDir, "simple-reversed.json"), {
  nested: { z: 9, m: 8 },
  b: 2,
  a: 1,
});
writeJson(join(keyOrderDir, "simple-pretty.json"), JSON.stringify({ b: 2, a: 1, nested: { z: 9, m: 8 } }, null, 4));
writeCanonicalFile(join(keyOrderDir, "array-order-a.json"), { m: [1, 2], k: { b: 1, a: 2 } });
writeCanonicalFile(join(keyOrderDir, "array-order-b.json"), { k: { a: 2, b: 1 }, m: [2, 1] });
writeCanonicalFile(join(keyOrderDir, "nested-objects.json"), {
  items: [
    { a: 2, z: 1 },
    { a: 4, b: 3 },
  ],
});
writeCanonicalFile(join(keyOrderDir, "nested-objects-reordered.json"), {
  items: [
    { z: 1, a: 2 },
    { b: 3, a: 4 },
  ],
});
writeCanonicalFile(
  join(keyOrderDir, "proto-keys.json"),
  JSON.parse('{"z":1,"__proto__":{"x":1},"a":2}'),
);
writeCanonicalFile(
  join(keyOrderDir, "proto-keys-reordered.json"),
  JSON.parse('{"a":2,"__proto__":{"x":1},"z":1}'),
);

const families = {};

for (const [id, packet] of Object.entries(bases)) {
  const basePath = join(packetsDir, `${id}.json`);
  writeCanonicalFile(basePath, packet);

  const reversed = reverseKeys(packet);
  const reorderedPath = join(packetsDir, `${id}.reordered.json`);
  writeCanonicalFile(reorderedPath, reversed);

  const prettyPath = join(packetsDir, `${id}.pretty.json`);
  writeJson(prettyPath, JSON.stringify(packet, null, 2));

  families[id] = {
    base: rel(basePath),
    reordered: rel(reorderedPath),
    pretty: rel(prettyPath),
  };
}

const action = bases["action-used-removed"];

const clockDiff = {
  ...action,
  createdAt: CLOCK2,
  clock: CLOCK2,
  provenance: action.provenance.map((row) => ({ ...row, retrievedAt: CLOCK2 })),
  limitations: limitations(["retrievedAt later than base; payload and decision hashes must still match"]),
};
writeCanonicalFile(join(packetsDir, "action-used-removed.clock-diff.json"), clockDiff);
families["action-used-removed"].clockDiff = rel(join(packetsDir, "action-used-removed.clock-diff.json"));

const bindingsReordered = {
  ...action,
  bindings: [...action.bindings].reverse(),
};
writeCanonicalFile(join(packetsDir, "action-used-removed.bindings-reordered.json"), bindingsReordered);
families["action-used-removed"].bindingsReordered = rel(
  join(packetsDir, "action-used-removed.bindings-reordered.json"),
);

const rationaleDiff = {
  ...action,
  bindings: action.bindings.map((row) =>
    row.symbol === "parse"
      ? { ...row, rationale: "caller uses parse; removal is an actionable change" }
      : row,
  ),
};
writeCanonicalFile(join(packetsDir, "action-used-removed.rationale-diff.json"), rationaleDiff);
families["action-used-removed"].rationaleDiff = rel(
  join(packetsDir, "action-used-removed.rationale-diff.json"),
);

// Distinct from base: exportDiff.added is a JSON array (order is significant
// for packet/payload hashes even when it is semantically a set).
const arrayOrderPacket = {
  ...action,
  exportDiff: {
    ...action.exportDiff,
    added: ["zz-last", "compat"],
    removed: ["parse"],
  },
};
writeCanonicalFile(join(packetsDir, "action-used-removed.array-order-changed.json"), arrayOrderPacket);
families["action-used-removed"].arrayOrderChanged = rel(
  join(packetsDir, "action-used-removed.array-order-changed.json"),
);

const digestRows = [];
const packetFiles = readdirSync(packetsDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

for (const name of packetFiles) {
  const path = join(packetsDir, name);
  const hashed = hashPacketFile(path);
  if (!hashed.ok) throw new Error(`${name}: ${hashed.code} ${hashed.message}`);
  digestRows.push({
    file: `packets/${name}`,
    label: hashed.label,
    evidenceClass: hashed.evidenceClass,
    nextAction: hashed.nextAction,
    packetHash: hashed.packetHash,
    payloadHash: hashed.payloadHash,
    decisionHash: hashed.decisionHash,
    sourceSha256: hashed.sourceSha256,
    sourceBytes: hashed.sourceBytes,
  });
}

const keyOrderFiles = readdirSync(keyOrderDir)
  .filter((name) => name.endsWith(".json"))
  .sort();
const keyOrderRows = [];
for (const name of keyOrderFiles) {
  const path = join(keyOrderDir, name);
  const raw = readFileSync(path);
  const parsed = JSON.parse(raw.toString("utf8"));
  keyOrderRows.push({
    file: `key-order/${name}`,
    canonicalJson: stableStringify(parsed),
    sha256: sha256Hex(parsed),
    sourceSha256: sha256Hex(raw),
  });
}

const replayChecks = {
  actionKeyOrder: compareReplay(bases["action-used-removed"], reverseKeys(bases["action-used-removed"])),
  actionPretty: compareReplay(
    bases["action-used-removed"],
    JSON.parse(JSON.stringify(bases["action-used-removed"])),
  ),
  actionClock: compareReplay(bases["action-used-removed"], clockDiff),
  actionBindings: compareReplay(bases["action-used-removed"], bindingsReordered),
  actionRationale: compareReplay(bases["action-used-removed"], rationaleDiff),
  actionVsUnused: compareReplay(bases["action-used-removed"], bases["no-action-unused"]),
  actionVsUnknown: compareReplay(bases["action-used-removed"], bases["unknown-dynamic"]),
};

const expected = {
  schema: "s127.upgrade-impact.packet-hash.expected.v1",
  label: "synthetic",
  capturedFromLive: false,
  clock: CLOCK,
  algo: "sha256",
  canonicalization: "JSON.stringify(sortKeys(value))",
  syntheticContentSha256: {
    "synthetic-dep/v1.0.0.js": SHA_V1,
    "synthetic-dep/v2.0.0-parse-removed.js": SHA_V2_PARSE_REMOVED,
    "synthetic-dep/v2.0.0-extra-removed.js": SHA_V2_EXTRA_REMOVED,
  },
  families,
  packets: digestRows,
  keyOrder: keyOrderRows,
  replayChecks: Object.fromEntries(
    Object.entries(replayChecks).map(([k, v]) => [
      k,
      {
        identicalPacket: v.identicalPacket,
        identicalPayload: v.identicalPayload,
        identicalDecision: v.identicalDecision,
      },
    ]),
  ),
};

writeJson(join(fixturesRoot, "expected-digests.json"), JSON.stringify(expected, null, 2));

const provenanceDoc = {
  schema: "s127.upgrade-impact.packet-hash.provenance.v1",
  label: "synthetic",
  evidenceClass: "fixture",
  capturedFromLive: false,
  paidDemand: false,
  capturedAtUtc: CLOCK,
  notes:
    "Cell c26 synthetic packets and key-order JSON. Not live-capture. Not a marketplace job. contentSha256 values are sha256 of small synthetic source strings, not registry tarballs.",
  algorithm: {
    hash: "sha256",
    canonicalization: "sorted object keys, JSON.stringify, utf8, lowercase hex",
    notRfc8785: true,
  },
  files: Object.fromEntries(
    [
      ...packetFiles.map((name) => [`packets/${name}`, fileMeta(name)]),
      ...keyOrderFiles.map((name) => [`key-order/${name}`, { label: "synthetic", role: "key-order unit" }]),
      ["expected-digests.json", { label: "synthetic", role: "pinned sha256 of canonical packets" }],
      ["synthetic-dep/v1.0.0.js", { label: "synthetic", role: "old source", contentSha256: SHA_V1 }],
      [
        "synthetic-dep/v2.0.0-parse-removed.js",
        { label: "synthetic", role: "new source, parse removed", contentSha256: SHA_V2_PARSE_REMOVED },
      ],
      [
        "synthetic-dep/v2.0.0-extra-removed.js",
        { label: "synthetic", role: "new source, unused extra removed", contentSha256: SHA_V2_EXTRA_REMOVED },
      ],
    ],
  ),
};

writeJson(join(fixturesRoot, "PROVENANCE.json"), JSON.stringify(provenanceDoc, null, 2));

function fileMeta(name) {
  const hashed = digestRows.find((row) => row.file === `packets/${name}`);
  const role = name.includes(".reordered.")
    ? "key-reorder of base packet"
    : name.includes(".pretty.")
      ? "pretty-printed whitespace variant"
      : name.includes("clock-diff")
        ? "same payload/decision, later clock and retrievedAt"
        : name.includes("bindings-reordered")
          ? "bindings array reversed; decision hash must match"
          : name.includes("rationale-diff")
            ? "rationale wording changed; decision hash must match"
            : name.includes("array-order-changed")
              ? "exportDiff.added array order/content changed; packet hash must differ"
              : "base packet";
  return {
    label: "synthetic",
    role,
    packetHash: hashed?.packetHash,
    payloadHash: hashed?.payloadHash,
    decisionHash: hashed?.decisionHash,
    sourceSha256: hashed?.sourceSha256,
  };
}

function rel(path) {
  return path.slice(fixturesRoot.length + 1);
}

const actionHash = hashPacket(bases["action-used-removed"]);
console.log(
  JSON.stringify(
    {
      ok: true,
      packetCount: packetFiles.length,
      keyOrderCount: keyOrderFiles.length,
      action: {
        packetHash: actionHash.packetHash,
        payloadHash: actionHash.payloadHash,
        decisionHash: actionHash.decisionHash,
      },
      syntheticContentSha256: expected.syntheticContentSha256,
    },
    null,
    2,
  ),
);
