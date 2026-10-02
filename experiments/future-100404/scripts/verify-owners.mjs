import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { verifyOwnerSources } from "./verify-owner-sources.mjs";

const pack = fileURLToPath(new URL("../", import.meta.url));
const qa = path.join(pack, ".runtime/merchant");
const sourceCheck = await verifyOwnerSources();
const files = [
  "commerce-outcome-binding.concurrency.test.mjs", "commerce-outcome-binding.test.mjs", "commerce-outcome-binding.root.test.mjs",
  "commerce-events.test.mjs", "task-linked-delivery/receiving.test.mjs", "http-delivery-evidence/test/contract.test.mjs",
  "http-delivery-evidence/test/capture.test.mjs", "http-delivery-evidence/test/store.test.mjs", "purchase-evidence-manifest.test.mjs",
  "useful-result-reuse.customer-grant.test.mjs", "useful-result-reuse.customer-http.test.mjs",
  "experiments/scoped-surface-delivery-100312/test/packaged-mount.test.mjs",
  "task-linked-delivery/experiments/useful-economics-100290/test/join.test.mjs",
  "task-linked-delivery/experiments/useful-economics-100290/test/merchant-execution.test.mjs",
];
const p = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  cwd: qa, env: { PATH: process.env.PATH || "", HTTP_DELIVERY_EVIDENCE_SETTLEMENT_CLASS: "simulated" }, encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024, timeout: 180000,
});
writeFileSync(path.join(pack, "receipts/retained-owners.tap"), p.stdout + p.stderr);
const get = name => Number((p.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m")) || [])[1] || 0);
const receipt = { schema: "samedaydesk.service-delivery.owner-verification.v1", base: "015f07d5a75d02a4e74709b17b2b1176501e92a5",
  execution: "actual Cursor Cloud VM", files, exitCode: p.status, tests: get("tests"), passed: get("pass"), failed: get("fail"), skipped: get("skipped"),
  sourceCheck, paymentBoundary: "disposable mocked tests only", production: false };
writeFileSync(path.join(pack, "receipts/retained-owners.json"), JSON.stringify(receipt, null, 2) + "\n");
process.stdout.write(JSON.stringify(receipt) + "\n");
process.exitCode = p.status || (receipt.failed || !receipt.tests ? 1 : 0);
