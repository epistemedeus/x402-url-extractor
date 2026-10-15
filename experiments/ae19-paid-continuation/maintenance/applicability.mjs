import { pathToFileURL } from "node:url";
import { join } from "node:path";

export const MAINTENANCE_TESTED_HEAD = "7c902ac54a992666aea1b2c044c145caaa0901ae";
export const MAINTENANCE_EXPORT_TIP = "46175775c06f7c115a69cd5eae2286131b43b651";

/**
 * Consume 244005's exported harness when the pin roots are present.
 * A missing export is pending-join, not a local reimplementation.
 */
export async function runMaintenanceExport({ maintenanceRoot, env }) {
  if (!maintenanceRoot) {
    return { status: "pending-join", reason: "244005_export_absent", schedulesCreated: 0 };
  }
  const previous = {
    SDS_INPUT_ROOT: process.env.SDS_INPUT_ROOT,
    MERCHANT_INPUT_ROOT: process.env.MERCHANT_INPUT_ROOT,
    GATEWAY_INPUT_ROOT: process.env.GATEWAY_INPUT_ROOT,
  };
  Object.assign(process.env, env);
  try {
    const harness = await import(pathToFileURL(join(maintenanceRoot, "bin/harness.mjs")).href);
    const changed = await harness.createHarness({ disposition: "changed" });
    await changed.start();
    let changedBody;
    try {
      changedBody = await changed.execute("assess", changed.assessInput);
    } finally {
      await changed.close();
    }
    const unchanged = await harness.createHarness({ disposition: "unchanged" });
    await unchanged.start();
    let unchangedBody;
    try {
      unchangedBody = await unchanged.execute("assess", unchanged.assessInput);
    } finally {
      await unchanged.close();
    }
    return {
      status: "consumed",
      testedHead: MAINTENANCE_TESTED_HEAD,
      exportTip: MAINTENANCE_EXPORT_TIP,
      schedulesCreated: 0,
      changed: {
        http: changedBody.status,
        disposition: changedBody.body?.output?.disposition || null,
        acceptance: changedBody.body?.output?.acceptance || null,
        effects: changedBody.body?.output?.effects || null,
        error: changedBody.body?.error?.code || null,
      },
      unchanged: {
        http: unchangedBody.status,
        disposition: unchangedBody.body?.output?.disposition || null,
        acceptance: unchangedBody.body?.output?.acceptance || null,
        effects: unchangedBody.body?.output?.effects || null,
        error: unchangedBody.body?.error?.code || null,
      },
    };
  } catch (error) {
    return {
      status: "pending-join",
      reason: "244005_export_failed",
      message: String(error?.message || error).slice(0, 500),
      schedulesCreated: 0,
    };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
