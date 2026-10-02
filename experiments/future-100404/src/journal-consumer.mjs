import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  authorizeOutcomeBinding, openCausalCommerceEvent, isForwardV2Record, isTaskRefRecord,
  isSchemaValidDeliveryEvidence, FORWARD_BINDING_FILENAME, FORWARD_BINDING_ROTATED_FILENAME,
  TASK_REF_FILENAME, TASK_REF_ROTATED_FILENAME,
} from "../../../commerce-outcome-binding.mjs";
import { producerBindings } from "../../../task-linked-delivery/experiments/useful-economics-100290/src/adapters.mjs";
import { assert, digest, hash } from "./value.mjs";

const FILES = [FORWARD_BINDING_FILENAME, FORWARD_BINDING_ROTATED_FILENAME, TASK_REF_FILENAME, TASK_REF_ROTATED_FILENAME];
const MAX_FILE = 1024 * 1024;
function fileStamp(st) { return st ? `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}` : "absent"; }
async function stamp(file) {
  try { const st = await lstat(file); assert(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, "journal_file_type"); return fileStamp(st); }
  catch (e) { if (e.code === "ENOENT") return "absent"; throw e; }
}
async function readLines(file, validator) {
  let fd;
  try { fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (e) { if (e.code === "ENOENT") return { rows: [], missing: true, incomplete: false }; throw e; }
  try {
    const before = await fd.stat();
    assert(before.isFile() && before.nlink === 1 && before.size <= MAX_FILE, "journal_read_bound");
    const bytes = Buffer.alloc(before.size + 1); let used = 0;
    while (used < bytes.length) {
      const r = await fd.read(bytes, used, bytes.length - used, used);
      if (!r.bytesRead) break;
      used += r.bytesRead;
    }
    assert(used === before.size && fileStamp(before) === fileStamp(await fd.stat()), "journal_changed_during_read");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, used));
    const lines = text.split("\n"); const tail = lines.pop();
    let incomplete = Boolean(tail); const rows = [];
    for (const line of lines) {
      if (!line) continue;
      if (Buffer.byteLength(line) > 4096) { incomplete = true; continue; }
      try { const row = JSON.parse(line); if (validator(row)) rows.push(row); else incomplete = true; }
      catch { incomplete = true; }
    }
    return { rows, missing: false, incomplete };
  } finally { await fd.close(); }
}

// Read-only view of the two generations the existing writer retains. The
// response seal comes from that writer's in-process causal callback, never
// from a caller header, wallet, task label or receipt digest.
export async function consumeJournalEvidence(target, { dataDir, causalEventProof, internalToken } = {}) {
  const empty = reason => ({
    schema: "samedaydesk.service-delivery.journal-consumer.v1", binding: "unknown", reason,
    settlement: "unknown", schemaDelivery: "unknown", retainedObservation: "unknown",
    coverage: "unknown", financialAction: "none", authority: "none", scopeDigest: digest(target),
    recognizedRevenue: "unknown", usefulDeliveryFromJournal: "unknown",
  });
  const eventId = openCausalCommerceEvent(causalEventProof, internalToken);
  if (!eventId) return empty("causal_producer_proof_absent_or_invalid");
  const claim = authorizeOutcomeBinding({
    "x-samedaydesk-internal": internalToken,
    "x-samedaydesk-outcome-task": target.taskId,
    "x-samedaydesk-outcome-operation": target.operationId,
    "x-samedaydesk-outcome-cohort": target.cohort || "owner_qa",
  }, internalToken);
  if (!claim?.taskRef) return empty("task_scope_unbound");
  if (!/^[a-f0-9]{64}$/.test(target.wireDigest || "")) return empty("response_bytes_absent");
  try {
    assert(typeof dataDir === "string", "journal_directory_required");
    const directory = path.resolve(dataDir);
    const st = await lstat(directory);
    assert(st.isDirectory() && !st.isSymbolicLink() && await realpath(directory) === directory, "journal_directory_type");
    const files = FILES.map(name => path.join(directory, name));
    const before = await Promise.all(files.map(stamp));
    const snapshots = await Promise.all(files.map((file, i) => readLines(file, i < 2 ? isForwardV2Record : isTaskRefRecord)));
    const after = await Promise.all(files.map(stamp));
    assert(digest(before) === digest(after), "journal_generation_changed");
    const forwards = snapshots.slice(0, 2).flatMap(s => s.rows);
    const links = snapshots.slice(2).flatMap(s => s.rows);
    const binding = producerBindings(links);
    const bound = binding.byEvent.get(eventId);
    if (binding.conflicts.includes(eventId)) return { ...empty("causal_binding_conflict"), binding: "conflicting" };
    if (!bound || bound.operationId !== claim.operationId || bound.taskRef !== claim.taskRef) return empty("current_task_reference_absent_or_wrong");
    const linked = links.filter(row => row.commerceEventId === eventId);
    if (linked.some(row => row.cohort !== claim.cohort)) return empty("cohort_conflict");
    const candidates = forwards.filter(row => row.commerceEventId === eventId);
    if (!candidates.length) return empty("forward_side_absent");
    if (candidates.some(row => row.operationId !== target.operationId || row.method !== target.method || row.route !== target.route || row.cohort !== claim.cohort)) {
      return { ...empty("event_scope_conflict"), binding: "conflicting" };
    }
    const byId = new Map();
    for (const row of candidates) {
      if (byId.has(row.eventId) && digest(byId.get(row.eventId)) !== digest(row)) return { ...empty("duplicate_record_conflict"), binding: "conflicting" };
      byId.set(row.eventId, row);
    }
    const rows = [...byId.values()];
    const artifactRows = rows.filter(row => row.receiptDigest !== null);
    if (artifactRows.some(row => row.receiptDigest !== target.wireDigest)) return empty("response_bytes_do_not_match_causal_event");
    const settlements = rows.filter(row => row.stage === "settlement");
    if (settlements.length > 1) return { ...empty("settlement_conflict"), binding: "conflicting" };
    const paid = settlements[0];
    let settlement = "unknown";
    if (paid?.settlementAuthority === "mocked_settlement_boundary" && ["simulated", "unpaid"].includes(paid.settlementClass)) settlement = paid.settlementClass;
    else if (paid?.settlementAuthority === "runtime_readback" && paid.settlementClass === "reconciled" && paid.settlementReference && paid.valueAtomic !== null) settlement = "reconciled";
    const incomplete = snapshots.some(s => s.incomplete);
    return {
      ...empty(null), binding: "bound", reason: null, authority: "existing_authenticated_producer_and_journal",
      coverage: incomplete ? "partial_retained_generations" : "retained_generations_only",
      journalSnapshotDigest: hash(JSON.stringify(before)), settlement,
      schemaDelivery: rows.some(isSchemaValidDeliveryEvidence) ? "schema_valid" : "unknown",
      retainedObservation: rows.some(row => row.stage === "retained_use" && row.correctionOf === null) ? "observed" : "unknown",
      correctionObserved: rows.some(row => row.correctionOf !== null),
      settlementAmount: "withheld_from_consumer", usefulDeliveryFromJournal: "unknown",
    };
  } catch (error) {
    return empty(["journal_generation_changed", "journal_changed_during_read"].includes(error?.code) ? "journal_snapshot_changed" : "journal_unavailable_or_incomplete");
  }
}

export function journalTarget(receipt, { cohort = "owner_qa" } = {}) {
  return { taskId: receipt.contract.taskId, operationId: receipt.contract.operationId,
    method: receipt.contract.request.method, route: receipt.contract.request.route,
    wireDigest: receipt.observations?.execution?.wireDigest || null, cohort };
}
