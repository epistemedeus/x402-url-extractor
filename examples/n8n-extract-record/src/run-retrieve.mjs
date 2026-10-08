import { readJsonFile } from "../../customer-x402/src/record/io.mjs";
import { HARD_CAPS } from "../../customer-x402/src/record/constants.mjs";
import { bindingId } from "./binding.mjs";
import { readArtifact } from "./store.mjs";

function refusal(reason, extra = {}) {
  return {
    ok: false,
    disposition: "explicit-negative",
    status: "refused",
    reason,
    refetched: false,
    paymentAttempted: false,
    settlement: "not_performed",
    feedbackSent: false,
    feedbackRetried: false,
    merchantGrant: false,
    storageAuthority: "caller-owned-directory",
    records: null,
    report: null,
    missingPaths: null,
    delivery: null,
    exitCode: 0,
    ...extra,
  };
}

function parseStored(files, name) {
  if (!Object.prototype.hasOwnProperty.call(files, name)) return null;
  return JSON.parse(files[name]);
}

export function runRetrieve({ storeRoot, artifactId, task } = {}) {
  let stored;
  try {
    stored = readArtifact(storeRoot, artifactId);
  } catch (error) {
    if (error.code === "artifact.foreign" || error.code === "artifact.escape") {
      return refusal(error.code, { message: error.message });
    }
    throw error;
  }
  if (!stored) return refusal("artifact_not_found", { status: "missing" });
  const presented = bindingId(task);
  if (presented !== artifactId || stored.manifest.inputBinding !== presented) {
    return refusal("input_binding_mismatch", {
      presentedBinding: presented,
      message: "The presented task does not match the stored artifact. Records were not returned.",
    });
  }
  const records = parseStored(stored.files, "records.json");
  const report = parseStored(stored.files, "report.json");
  const missingPaths = parseStored(stored.files, "missing-paths.json");
  const delivery = parseStored(stored.files, "delivery.json");
  return {
    ok: stored.manifest.disposition === "artifact" && (stored.manifest.status === "success" || stored.manifest.status === "partial"),
    disposition: stored.manifest.disposition,
    status: stored.manifest.status,
    reason: stored.manifest.reason || null,
    artifactId: stored.manifest.artifactId,
    inputBinding: stored.manifest.inputBinding,
    reused: true,
    refetched: false,
    paymentAttempted: false,
    settlement: stored.manifest.settlement,
    feedbackSent: false,
    merchantGrant: false,
    storageAuthority: stored.manifest.storageAuthority,
    handlerChargedFieldIsSettlement: false,
    recordStatus: stored.manifest.recordStatus ?? null,
    records,
    report,
    missingPaths,
    delivery,
    provenance: stored.manifest.provenanceSample ?? null,
    exitCode: 0,
  };
}

export function runRetrieveFromPaths({ storeRoot, artifactId, taskPath } = {}) {
  if (!storeRoot || !artifactId || !taskPath) {
    return {
      ok: false,
      status: "usage",
      exitCode: 2,
      error: "store, artifact id, and task are required",
      refetched: false,
    };
  }
  const taskFile = readJsonFile(taskPath, HARD_CAPS.maxInputBytes, "task");
  return runRetrieve({ storeRoot, artifactId, task: taskFile.value });
}
