export * as packet from "./packet.mjs";
export * as common from "./common.mjs";
export * as migrationChecklist from "./migration-checklist.mjs";
export * as releaseBrief from "./release-brief.mjs";
export * as tableReconcile from "./table-reconcile.mjs";
export * as linkIndex from "./link-index.mjs";
export * as replayPack from "./replay-pack.mjs";
export * as freshnessReceipt from "./freshness-receipt.mjs";

export const ARTIFACTS = Object.freeze([
  "migration-checklist",
  "release-brief",
  "table-reconcile",
  "link-index",
  "replay-pack",
  "freshness-receipt",
]);

export const EXCLUDED_JOBS = Object.freeze([
  "R2-CONSUMER-JOBS-07",
  "R2-CONSUMER-JOBS-08",
]);

export const PIN = "fa6878de125cfdcfd77f4b47037c88667090d293";
