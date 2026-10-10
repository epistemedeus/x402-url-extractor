// Read a mounted producer directory and join synthetic settlement observations.
// The observations are not funds. Producer bytes are only read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isCanonicalMcpTypedCommerceEvent } from "./commerce-events.mjs";
import { SCHEMA_VERSION } from "./commerce-settlement-reconciler.mjs";
import {
  digestMcpCallId,
  digestMcpDeliveryBinding,
  isHistoricalV1PaidSuccess,
  openStore,
  parseNdjson,
} from "./http-delivery-evidence/index.mjs";
import {
  FILE_CLASSES,
  PRODUCER_BASE_SHA,
  receiveOrdinaryDeliveryJoin,
  reportViolations,
} from "./ordinary-delivery-join.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WINDOW_START = "2026-01-01T00:00:00.000Z";
const WINDOW_END = "2027-01-01T00:00:00.000Z";
const COMPLETE = new Set(["full_bounded_capture", "complete_useful", "useful_negative", "source_refusal"]);

function ndjson(rows) {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function expectedDisposition(deliveryClass, validatorVerdict) {
  if (deliveryClass === "truncated_partial") return "incomplete_capture";
  if (deliveryClass === "upstream_failed" || deliveryClass === "malformed_body" || validatorVerdict === "invalid") {
    return "rejected_schema";
  }
  if (validatorVerdict === "pass" && COMPLETE.has(deliveryClass)) return "exact_join";
  return "incomplete_capture";
}

function settlementFor({
  sourceEventId,
  timestamp,
  route,
  protocol,
  settlementReference,
  amountAtomic,
  network,
  asset,
  treasury,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: "reconciled",
    sourceEventId,
    sourceEventTimestamp: timestamp,
    route,
    protocol,
    paymentClass: "unclassified",
    settlementReference,
    amountAtomic,
    ...(typeof network === "string" ? { network } : {}),
    ...(typeof asset === "string" ? { asset } : {}),
    ...(typeof treasury === "string" ? { treasury } : {}),
  };
}

function matchingMcpParent(event, fields) {
  const facts = typeof event?.settlementAmountAtomic === "string"
    ? {
      amountAtomic: event.settlementAmountAtomic,
      network: event.settlementNetwork,
      asset: event.settlementCurrency,
      treasury: event.settlementPayee,
    }
    : { amountAtomic: fields.amountAtomic };
  return settlementFor({ ...fields, ...facts });
}

async function fingerprint(dir) {
  const names = (await readdir(dir)).sort();
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const info = await stat(file);
    if (!info.isFile()) continue;
    const bytes = await readFile(file);
    out.push([name, createHash("sha256").update(bytes).digest("hex"), bytes.length]);
  }
  return out;
}

async function readTyped(dataDir) {
  const typed = [];
  for (const name of [FILE_CLASSES.commerceEvents, FILE_CLASSES.commerceEventsRotated]) {
    const text = await readFile(path.join(dataDir, name), "utf8").catch((error) => (
      error?.code === "ENOENT" ? "" : Promise.reject(error)
    ));
    for (const row of parseNdjson(text)) {
      if (isCanonicalMcpTypedCommerceEvent(row)) typed.push(row);
    }
  }
  return typed;
}

async function readPaid(dataDir) {
  const text = await readFile(path.join(dataDir, FILE_CLASSES.paidSuccessEvidence), "utf8").catch((error) => (
    error?.code === "ENOENT" ? "" : Promise.reject(error)
  ));
  return parseNdjson(text).filter((row) => isHistoricalV1PaidSuccess(row));
}

async function receive(files, { cli = false } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "ordinary-join-mounted-"));
  try {
    for (const [name, rows] of Object.entries(files)) {
      if (!rows || rows.length === 0) continue;
      await writeFile(path.join(dir, name), ndjson(rows));
    }
    const report = await receiveOrdinaryDeliveryJoin({
      dataDir: dir,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      coverage: "unknown_for_full_window",
      sourceSha: PRODUCER_BASE_SHA,
      includeLocalIds: true,
    });
    if (cli) {
      const child = spawnSync(process.execPath, [
        path.join(ROOT, "ordinary-delivery-join-cli.mjs"),
        "--data-dir", dir,
        "--window-start", WINDOW_START,
        "--window-end", WINDOW_END,
        "--coverage", "unknown_for_full_window",
        "--source-sha", PRODUCER_BASE_SHA,
        "--local-ids",
      ], { cwd: ROOT, encoding: "utf8" });
      assert.equal(child.status, 0, child.stderr);
      const parsed = JSON.parse(child.stdout);
      assert.deepEqual(parsed.counts, report.counts);
      assert.equal(parsed.rows.length, report.rows.length);
      report.cliStatus = child.status;
    }
    return report;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function proveMountedDeliveryJoin(dataDir) {
  const before = await fingerprint(dataDir);
  const paid = await readPaid(dataDir);
  const paidIds = new Set(paid.map((row) => row.id));
  const store = openStore(dataDir);
  const validations = await store.readValidations();
  const mcpDeliveries = await store.readMcpDeliveries();
  const typed = await readTyped(dataDir);
  const isolated = [];

  for (const row of paid) {
    const captures = validations.filter((item) => item.paidEvidenceId === row.id);
    if (captures.length !== 1 || !row.settlementReference) continue;
    const ledger = settlementFor({
      sourceEventId: row.id,
      timestamp: row.responseFinishedAt,
      route: row.route,
      protocol: row.paymentProtocol,
      settlementReference: row.settlementReference,
      amountAtomic: row.route === "/defi/morpho-position" ? "20000" : "5000",
    });
    const report = await receive({
      [FILE_CLASSES.settlementLedger]: [ledger],
      [FILE_CLASSES.paidSuccessEvidence]: [row],
      [FILE_CLASSES.httpValidation]: captures,
    }, { cli: isolated.length === 0 });
    assert.deepEqual(reportViolations(report), []);
    const found = report.rows[0];
    const disposition = expectedDisposition(captures[0].deliveryClass, captures[0].validatorVerdict);
    assert.equal(found.disposition, disposition, `${row.route} ${captures[0].deliveryClass}`);
    assert.equal(found.eventCanonical, "http_v1");
    assert.equal(found.usefulness, "unknown");
    assert.equal(found.httpAttached, 1);
    assert.equal(found.mcpAttached, 0);
    assert.equal(JSON.stringify(report.rows.map((item) => ({ ...item, local: undefined }))).includes(captures[0].responseDigest), false);
    isolated.push({
      kind: "http",
      id: row.id,
      deliveryClass: captures[0].deliveryClass,
      disposition: found.disposition,
      responseDigest: captures[0].responseDigest,
      reference: row.settlementReference,
      timestamp: row.responseFinishedAt,
      route: row.route,
      protocol: row.paymentProtocol,
      paid: row,
      capture: captures[0],
    });
  }

  let replayRefused = false;
  let mcpJoinedWithoutHttpV1 = false;
  for (const event of typed) {
    if (!["paid_success", "application_failure", "replay_success", "settlement_failure"].includes(event.result)) continue;
    const captures = mcpDeliveries.filter((item) => item.paidEvidenceId === event.id);
    if (event.result === "application_failure" && !captures.some((item) => item.settlementReference)) {
      const report = await receive({
        [FILE_CLASSES.commerceEvents]: [event],
        [FILE_CLASSES.mcpDelivery]: captures,
      });
      assert.equal(report.rows.length, 1);
      assert.equal(report.rows[0].disposition, "replayed_or_unknown_settlement");
      assert.equal(report.rows[0].individualJoin, false);
      assert.equal(report.rows[0].usefulness, "unknown");
      assert.equal(report.rows[0].eventCanonical, "mcp_typed_outcome");
      assert.equal(paidIds.has(event.id), false);
      isolated.push({ kind: "mcp-unsettled", id: event.id, deliveryClass: captures[0]?.deliveryClass || null, disposition: report.rows[0].disposition });
      continue;
    }
    const capture = captures[0] || null;
    const reference = capture?.settlementReference || `0x${"e".repeat(64)}`;
    const ledger = matchingMcpParent(event, {
      sourceEventId: event.id,
      timestamp: event.ts,
      route: "/mcp",
      protocol: "x402",
      settlementReference: reference,
      amountAtomic: "20000",
    });
    const report = await receive({
      [FILE_CLASSES.settlementLedger]: [ledger],
      [FILE_CLASSES.commerceEvents]: [event],
      [FILE_CLASSES.mcpDelivery]: captures,
    });
    assert.deepEqual(reportViolations(report), []);
    const found = report.rows[0];
    assert.equal(found.eventCanonical, "mcp_typed_outcome");
    assert.equal(found.paidEvidencePresent, false);
    assert.equal(found.usefulness, "unknown");
    assert.equal(found.httpAttached, 0);
    assert.equal(paidIds.has(event.id), false);
    if (event.result === "replay_success") {
      assert.equal(found.disposition, "replayed_or_unknown_settlement");
      assert.ok(found.reasons.includes("typed_replay"));
      assert.equal(found.individualJoin, false);
      replayRefused = true;
    } else if (capture && event.binding?.tool === "morpho_position") {
      const disposition = expectedDisposition(capture.deliveryClass, capture.validatorVerdict);
      assert.equal(found.disposition, disposition, `${event.result} ${capture.deliveryClass}`);
      assert.equal(found.mcpAttached, 1);
      if (disposition === "exact_join") mcpJoinedWithoutHttpV1 = true;
    } else {
      assert.notEqual(found.disposition, "exact_join");
    }
    isolated.push({
      kind: "mcp",
      id: event.id,
      deliveryClass: capture?.deliveryClass || null,
      disposition: found.disposition,
      responseDigest: capture?.responseDigest || null,
      reference,
      timestamp: event.ts,
      route: "/mcp",
      protocol: "x402",
      event,
      captures,
    });
  }

  const httpTwins = isolated.filter((item) => item.kind === "http" && item.responseDigest);
  const mcpTwins = isolated.filter((item) => item.kind === "mcp" && item.responseDigest);
  let identicalBodyDistinct = false;
  for (const pool of [httpTwins, mcpTwins]) {
    const byDigest = new Map();
    for (const item of pool) {
      if (!byDigest.has(item.responseDigest)) byDigest.set(item.responseDigest, []);
      byDigest.get(item.responseDigest).push(item);
    }
    const pair = [...byDigest.values()].find((items) => new Set(items.map((item) => item.id)).size > 1);
    if (!pair) continue;
    const [left, right] = pair;
    const files = left.kind === "http"
      ? {
        [FILE_CLASSES.settlementLedger]: [left, right].map((item) => settlementFor({
          sourceEventId: item.id,
          timestamp: item.timestamp,
          route: item.route,
          protocol: item.protocol,
          settlementReference: item.reference,
          amountAtomic: item.route === "/defi/morpho-position" ? "20000" : "5000",
        })),
        [FILE_CLASSES.paidSuccessEvidence]: [left.paid, right.paid],
        [FILE_CLASSES.httpValidation]: [left.capture, right.capture],
      }
      : {
        [FILE_CLASSES.settlementLedger]: [left, right].map((item) => matchingMcpParent(item.event, {
          sourceEventId: item.id,
          timestamp: item.timestamp,
          route: "/mcp",
          protocol: "x402",
          settlementReference: item.reference,
          amountAtomic: "20000",
        })),
        [FILE_CLASSES.commerceEvents]: [left.event, right.event],
        [FILE_CLASSES.mcpDelivery]: [...left.captures, ...right.captures],
      };
    const report = await receive(files);
    assert.equal(report.rows.length, 2);
    assert.notEqual(report.rows[0].local.sourceEventId, report.rows[1].local.sourceEventId);
    const exacts = report.rows.filter((row) => row.disposition === "exact_join");
    if (String(left.reference).toLowerCase() === String(right.reference).toLowerCase()) {
      assert.ok(exacts.length <= 1);
      assert.ok(report.rows.some((row) => row.reasons.includes("duplicate_settlement_reference")));
    } else {
      assert.equal(exacts.length, 2);
    }
    identicalBodyDistinct = true;
  }

  const httpExact = isolated.find((item) => item.kind === "http" && item.disposition === "exact_join");
  if (httpExact) {
    const twinId = "12121212-1212-4121-8121-121212121212";
    const twinReference = `0x${"7".repeat(64)}`;
    const twinRequest = httpExact.paid.requestDigest.replace(/^./, (char) => (char === "a" ? "b" : "a"));
    const twinPaid = { ...httpExact.paid, id: twinId, requestDigest: twinRequest, settlementReference: twinReference };
    const twinCapture = {
      ...httpExact.capture,
      paidEvidenceId: twinId,
      requestDigest: twinRequest,
      settlementReference: twinReference,
    };
    const report = await receive({
      [FILE_CLASSES.settlementLedger]: [
        settlementFor({
          sourceEventId: httpExact.id,
          timestamp: httpExact.timestamp,
          route: httpExact.route,
          protocol: httpExact.protocol,
          settlementReference: httpExact.reference,
          amountAtomic: httpExact.route === "/defi/morpho-position" ? "20000" : "5000",
        }),
        settlementFor({
          sourceEventId: twinId,
          timestamp: httpExact.timestamp,
          route: httpExact.route,
          protocol: httpExact.protocol,
          settlementReference: twinReference,
          amountAtomic: httpExact.route === "/defi/morpho-position" ? "20000" : "5000",
        }),
      ],
      [FILE_CLASSES.paidSuccessEvidence]: [httpExact.paid, twinPaid],
      [FILE_CLASSES.httpValidation]: [httpExact.capture, twinCapture],
    });
    assert.equal(report.rows.length, 2);
    assert.equal(report.rows.every((row) => row.disposition === "exact_join"), true);
    assert.notEqual(report.rows[0].local.sourceEventId, report.rows[1].local.sourceEventId);
    assert.equal(httpExact.capture.responseDigest, twinCapture.responseDigest);
    identicalBodyDistinct = true;
  }
  const mcpExact = isolated.find((item) => item.kind === "mcp" && item.disposition === "exact_join" && item.captures?.length === 1);
  if (mcpExact) {
    const twinId = "13131313-1313-4131-8131-131313131313";
    const twinReference = `0x${"6".repeat(64)}`;
    const callId = "twin-call";
    const callDigest = digestMcpCallId(callId);
    const capture = mcpExact.captures[0];
    const twinCapture = {
      ...capture,
      paidEvidenceId: twinId,
      callId,
      callDigest,
      requestDigest: digestMcpDeliveryBinding({
        tool: capture.tool,
        callDigest,
        issuedOfferDigest: capture.issuedOfferDigest,
      }),
      settlementReference: twinReference,
    };
    const twinEvent = {
      ...mcpExact.event,
      id: twinId,
      ...(typeof mcpExact.event.settlementReference === "string" ? { settlementReference: twinReference } : {}),
    };
    const report = await receive({
      [FILE_CLASSES.settlementLedger]: [
        matchingMcpParent(mcpExact.event, {
          sourceEventId: mcpExact.id,
          timestamp: mcpExact.timestamp,
          route: "/mcp",
          protocol: "x402",
          settlementReference: capture.settlementReference,
          amountAtomic: "20000",
        }),
        matchingMcpParent(twinEvent, {
          sourceEventId: twinId,
          timestamp: mcpExact.timestamp,
          route: "/mcp",
          protocol: "x402",
          settlementReference: twinReference,
          amountAtomic: "20000",
        }),
      ],
      [FILE_CLASSES.commerceEvents]: [mcpExact.event, twinEvent],
      [FILE_CLASSES.mcpDelivery]: [capture, twinCapture],
    });
    assert.equal(report.rows.length, 2);
    assert.equal(report.rows.every((row) => row.disposition === "exact_join" && row.eventCanonical === "mcp_typed_outcome"), true);
    assert.equal(report.rows.every((row) => row.paidEvidencePresent === false), true);
    assert.notEqual(report.rows[0].local.sourceEventId, report.rows[1].local.sourceEventId);
    assert.equal(capture.responseDigest, twinCapture.responseDigest);
    assert.notEqual(capture.callDigest, twinCapture.callDigest);
    identicalBodyDistinct = true;
  }

  let foreignRefused = false;
  const httpOne = isolated.find((item) => item.kind === "http" && item.disposition === "exact_join");
  if (httpOne) {
    const moved = await receive({
      [FILE_CLASSES.settlementLedger]: [settlementFor({
        sourceEventId: httpOne.id,
        timestamp: httpOne.timestamp,
        route: httpOne.route,
        protocol: httpOne.protocol,
        settlementReference: `0x${"9".repeat(64)}`,
        amountAtomic: "5000",
      })],
      [FILE_CLASSES.paidSuccessEvidence]: [httpOne.paid],
      [FILE_CLASSES.httpValidation]: [httpOne.capture],
    });
    assert.equal(moved.rows[0].disposition, "conflicting_join");
    assert.ok(moved.rows[0].reasons.includes("settlement_does_not_match_paid_event"));
    assert.equal(moved.rows[0].individualJoin, false);
    foreignRefused = true;
  }
  const mcpOne = isolated.find((item) => item.kind === "mcp" && item.event?.result === "paid_success" && item.captures?.length === 1);
  if (mcpOne) {
    const capture = mcpOne.captures[0];
    const base = {
      [FILE_CLASSES.settlementLedger]: [matchingMcpParent(mcpOne.event, {
        sourceEventId: mcpOne.id,
        timestamp: mcpOne.timestamp,
        route: "/mcp",
        protocol: "x402",
        settlementReference: capture.settlementReference,
        amountAtomic: "20000",
      })],
      [FILE_CLASSES.commerceEvents]: [mcpOne.event],
    };
    const foreignCall = await receive({
      ...base,
      [FILE_CLASSES.mcpDelivery]: [{ ...capture, callDigest: "ab".repeat(32) }],
    });
    const foreignOffer = await receive({
      ...base,
      [FILE_CLASSES.commerceEvents]: [{
        ...mcpOne.event,
        binding: { ...mcpOne.event.binding, issuedOfferDigest: "cd".repeat(32) },
      }],
      [FILE_CLASSES.mcpDelivery]: [capture],
    });
    const foreignReference = await receive({
      ...base,
      [FILE_CLASSES.mcpDelivery]: [{ ...capture, settlementReference: `0x${"9".repeat(64)}` }],
    });
    assert.equal(foreignCall.rows[0].disposition, "conflicting_join");
    assert.ok(foreignCall.rows[0].reasons.includes("foreign_call"));
    assert.equal(foreignOffer.rows[0].disposition, "conflicting_join");
    assert.ok(foreignOffer.rows[0].reasons.includes("foreign_offer"));
    assert.equal(foreignReference.rows[0].disposition, "conflicting_join");
    assert.ok(foreignReference.rows[0].reasons.includes("foreign_reference"));
    assert.equal(foreignCall.rows[0].individualJoin, false);
    foreignRefused = true;
  }

  const unknownPaid = paid.find((row) => !isolated.some((item) => item.id === row.id)) || paid[0];
  if (unknownPaid) {
    const unknown = await receive({ [FILE_CLASSES.paidSuccessEvidence]: [unknownPaid] });
    assert.equal(unknown.rows[0].disposition, "replayed_or_unknown_settlement");
    assert.ok(unknown.rows[0].reasons.includes("settlement_not_in_canonical_ledger"));
    assert.equal(unknown.rows[0].individualJoin, false);
  }

  const after = await fingerprint(dataDir);
  assert.deepEqual(after, before);
  const seeded = spawnSync(process.execPath, [
    path.join(ROOT, "ordinary-delivery-join-cli.mjs"),
    "--check-report",
    "experiments/ordinary-delivery-join-1006/fixtures/seeded-count-join.json",
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(seeded.status, 1, seeded.stdout);
  const seededCodes = JSON.parse(seeded.stdout);
  assert.ok(seededCodes.includes("exact_join_without_capture"));
  assert.ok(seededCodes.includes("usefulness_filled"));

  return {
    producerUnchanged: true,
    classes: [...new Set(isolated.map((item) => item.deliveryClass).filter(Boolean))],
    identicalBodyDistinct,
    mcpJoinedWithoutHttpV1,
    foreignRefused,
    replayRefused,
    isolated,
    seededStatus: seeded.status,
    seededStdout: seeded.stdout.trim(),
  };
}
