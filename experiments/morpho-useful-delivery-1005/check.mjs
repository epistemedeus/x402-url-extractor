#!/usr/bin/env node
// Rejects a measurement that treats HTTP 200 ok:false as useful delivery,
// backfills the 2026-10-05 Morpho body, or proposes a new paid offer.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { runMeasurement } from "./measure.mjs";

const SCHEMA = "samedaydesk.morpho-useful-delivery-1005.v1";
const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/;

export function violations(evidence, { canonical = null } = {}) {
  const found = [];
  const bad = (code) => {
    if (!found.includes(code)) found.push(code);
  };
  if (!evidence || typeof evidence !== "object") return ["evidence_not_object"];
  if (evidence.schema !== SCHEMA) bad("schema");
  const classes = evidence.classes || {};
  if (classes.http200OkFalse === "complete_useful" || classes.http200OkFalse === "full_bounded_capture") {
    bad("http_200_ok_false_counted_useful");
  }
  if (classes.okSnapshot && classes.okSnapshot === classes.http200OkFalse) bad("classes_collapsed");
  if (evidence.historical?.backfilled === true) bad("historical_backfill");
  if (evidence.historical?.outputRetained === true) bad("historical_output_invented");
  if (evidence.historical?.usefulness && evidence.historical.usefulness !== "unknown") bad("usefulness");
  if (evidence.historical?.buyerPredicate && evidence.historical.buyerPredicate !== "unknown") bad("buyer_predicate");
  if (evidence.usefulnessOnMeasuredClasses && evidence.usefulnessOnMeasuredClasses !== "unknown") bad("usefulness");
  if (evidence.proposeNewPaidOffer === true) bad("new_paid_offer");
  if (evidence.incrementalUtility === true) bad("incremental_utility_claimed");
  if (evidence.paymentTimingChanged === true) bad("payment_timing");
  if (evidence.responseShapeChanged === true) bad("response_shape");
  if (ADDRESS_RE.test(JSON.stringify(evidence))) bad("address_export");
  if (canonical && JSON.stringify(evidence) !== JSON.stringify(canonical)) bad("measurement_drift");
  return found;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node experiments/morpho-useful-delivery-1005/check.mjs <evidence.json>");
    process.exit(2);
  }
  const evidence = JSON.parse(await readFile(path, "utf8"));
  const canonical = path.endsWith("EVIDENCE.json") ? await runMeasurement() : null;
  const found = violations(evidence, { canonical });
  if (found.length) {
    console.error(JSON.stringify({ ok: false, violations: found }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    okSnapshot: evidence.classes.okSnapshot,
    http200OkFalse: evidence.classes.http200OkFalse,
    noPosition: evidence.classes.noPosition,
    truncated: evidence.classes.truncated,
    incrementalUtility: evidence.incrementalUtility,
    proposeNewPaidOffer: evidence.proposeNewPaidOffer,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(2);
  });
}
