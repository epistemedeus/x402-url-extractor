#!/usr/bin/env node
import { auditCatalog, loadCatalog, recommendedTable } from "./catalog.mjs";
import { evaluateEntry } from "./policy.mjs";

const json = process.argv.includes("--json");
const catalog = loadCatalog();
const audit = auditCatalog(catalog);

if (json) {
  console.log(
    JSON.stringify(
      {
        ok: audit.ok,
        schema: audit.schema,
        minimal: audit.minimal,
        gateFailures: audit.gate.failures,
        liveCaptureMismatches: audit.liveCaptureMismatches,
        recommended: recommendedTable(catalog),
        rejectedGpl: catalog.entries
          .filter((e) => evaluateEntry(e).licenseClass === "denied")
          .map((e) => ({ id: e.id, license: e.effectiveSpdx ?? e.licenseSpdx })),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`schema ${audit.schema} ok=${audit.ok}`);
  console.log(`minimal missing: ${audit.minimal.missing.join(", ") || "(none)"}`);
  console.log("recommended / optional:");
  for (const row of recommendedTable(catalog)) {
    console.log(`  ${row.decision.padEnd(10)} ${row.id.padEnd(28)} ${row.license}  reuse=${row.reuse}`);
  }
  if (audit.gate.failures.length) {
    console.log("gate failures:");
    for (const f of audit.gate.failures) console.log("  ", f);
  }
  if (audit.liveCaptureMismatches.length) {
    console.log("live-capture mismatches:");
    for (const m of audit.liveCaptureMismatches) console.log("  ", m);
  }
}

if (!audit.ok) process.exit(1);
