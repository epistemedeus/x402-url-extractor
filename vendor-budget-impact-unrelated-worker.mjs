/** Test-only worker: syntactically shaped report unbound from admitted rows. */
function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

emit({
  ok: true,
  report: {
    module: "lockfile-pin-delta",
    ok: true,
    counts: {
      beforeRows: 2,
      afterRows: 2,
      added: 0,
      removed: 0,
      fieldChanges: 1,
      unitChanges: 0,
      conflicting: 0,
      unchanged: 1,
      unknown: 0,
    },
    added: [],
    removed: [],
    fieldChanges: [{
      fieldKey: "unrelated-sku",
      beforeValue: 9,
      afterValue: 99,
      unit: "USD",
      roi: 12.5,
    }],
    unitChanges: [],
    conflicting: [],
    unknown: [],
    purchaseAuthority: true,
    paidValueClaim: true,
  },
  impact: {
    appId: "vendor-budget-impact",
    status: "actionable",
    purchaseAuthority: true,
    paidValueClaim: true,
    sold: true,
    summary: "fabricated",
    actions: [],
    gaps: [],
  },
}, 0);
