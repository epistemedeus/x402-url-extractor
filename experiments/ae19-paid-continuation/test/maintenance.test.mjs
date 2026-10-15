import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { MAINTENANCE_EXPORT_TIP, MAINTENANCE_TESTED_HEAD, runMaintenanceExport } from "../maintenance/applicability.mjs";

const maintenanceRoot = process.env.AE19_MAINTENANCE_ROOT || "";
const env = {
  SDS_INPUT_ROOT: process.env.AE19_SDS_ROOT || "",
  MERCHANT_INPUT_ROOT: process.env.AE19_MERCHANT_INPUT || "",
  GATEWAY_INPUT_ROOT: process.env.AE19_GATEWAY_INPUT || "",
};

test("244005 export is consumed when its pinned roots are present", { timeout: 120_000 }, async () => {
  const present = [maintenanceRoot, env.SDS_INPUT_ROOT, env.MERCHANT_INPUT_ROOT, env.GATEWAY_INPUT_ROOT].every((path) => existsSync(path));
  const result = await runMaintenanceExport({ maintenanceRoot: present ? maintenanceRoot : "", env });
  assert.equal(result.schedulesCreated, 0);
  if (!present) {
    assert.equal(result.status, "pending-join");
    return;
  }
  assert.equal(result.status, "consumed", JSON.stringify({ reason: result.reason, message: result.message }));
  assert.equal(result.testedHead, MAINTENANCE_TESTED_HEAD);
  assert.equal(result.exportTip, MAINTENANCE_EXPORT_TIP);
  assert.equal(result.changed.disposition, "bounded_assessment");
  assert.equal(result.unchanged.disposition, "not_yet_due");
  assert.equal(result.changed.effects.paymentAttempts, 0);
  assert.equal(result.changed.effects.captures, 0);
  assert.equal(result.changed.effects.paidTaskIncrement, 0);
  assert.equal(result.unchanged.effects.paymentAttempts, 0);
  assert.equal(result.unchanged.effects.repairExecutions, 0);
});
