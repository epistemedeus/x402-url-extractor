#!/usr/bin/env node
// Later consumer. It receives only a shareable regression and the journal
// directory. Payment, reward, and owner credentials are refused, not inherited.

import fs from "node:fs";
import { runScan } from "../src/adapter.mjs";
import { ensurePublicScanner, ensureRetentionAuthority } from "../src/hydrate.mjs";
import { createRetention } from "../src/regression.mjs";

const forbidden = ["USEFUL_RESULT_GRANT", "COMMERCE_INTERNAL_TOKEN", "PAYMENT_SIGNATURE", "X402_PAYMENT"];
if (forbidden.some((name) => process.env[name])) {
  process.stderr.write("payment_context_refused\n");
  process.exit(64);
}
const regressionPath = process.argv[2];
const journalDir = process.argv[3];
if (!regressionPath || !journalDir) {
  process.stderr.write("regression_and_journal_required\n");
  process.exit(64);
}
const regression = JSON.parse(fs.readFileSync(regressionPath, "utf8"));
if (regression.payment || regression.reward || regression.ownerId || regression.grant) {
  process.stderr.write("ownership_not_inherited\n");
  process.exit(64);
}
const pins = await ensurePublicScanner();
const authority = ensureRetentionAuthority();
const scan = (request, scanOptions = {}) => runScan(request, {
  skillguardRoot: pins.skillguardRoot,
  budget: scanOptions.budget || null,
});
scan.skillguardRoot = pins.skillguardRoot;
const retention = createRetention({
  journalDir,
  authorityFile: authority.authorityFile,
  clock: () => process.env.SCOPED_SURFACE_CLOCK || new Date().toISOString(),
  scan,
  skillguardRoot: pins.skillguardRoot,
});
const decision = await retention.read(regression.id, {
  contextId: process.argv[4] || null,
  files: process.argv[5] ? JSON.parse(fs.readFileSync(process.argv[5], "utf8")) : null,
});
const rescan = await runScan({
  taskId: regression.taskId,
  callerId: "later-consumer",
  contextId: regression.contextId,
  concern: regression.concern,
  files: regression.files.map((file) => ({ path: file.path, text: file.text })),
}, { skillguardRoot: pins.skillguardRoot });
const body = {
  schema: "samedaydesk.scoped-surface.later-consumer.v1",
  authorized: decision.authorized,
  reason: decision.reason,
  grants: decision.grants,
  paymentPermitted: false,
  rewardInherited: false,
  ownerInherited: false,
  rescan: {
    concern: rescan.concern,
    scannerExit: rescan.scannerExit,
    scannerVersion: rescan.scanner?.version,
    examinedBytes: rescan.examined?.bytes,
    universalGuarantee: false,
    blanketSafetyScore: null,
  },
  cash: "unknown",
  tokens: "unknown",
  profit: "unknown",
};
process.stdout.write(`${JSON.stringify(body)}\n`);
if (!decision.authorized) process.exit(65);
process.exit(rescan.exitCode);
