import { createHash } from "node:crypto";
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import path from 'node:path';

// One process, one resolved directory. Reentrant admission lets an existing
// producer call its canonical store while a capture excludes every other write.
// This is deliberately not a cross-process lock or another persistence layer.
const admission = new AsyncLocalStorage();
const gates = new Map();
const producers = new WeakMap();
const runtimes = new WeakMap();
const taskBindings = new WeakSet();
export function registerJournalTaskBinding(record) { if (record) taskBindings.add(record); return record; }
export function journalTaskBinding(record) { return !!record && taskBindings.has(record); }
function keyFor(dir) {
  try { return realpathSync(dir); } catch { return path.resolve(dir); }
}
export function journalState(dir) {
  const key = keyFor(dir);
  if (!gates.has(key)) gates.set(key, { tail: Promise.resolve(), rotations: {}, faults: {}, writes: {}, hashes: {}, owners: new Set() });
  return gates.get(key);
}
export function admitCommerceJournal(dir, work) {
  const key = keyFor(dir);
  if (admission.getStore() === key) return work();
  const gate = journalState(dir);
  const run = gate.tail.then(() => admission.run(key, work), () => admission.run(key, work));
  gate.tail = run.then(() => undefined, () => undefined);
  return run;
}
export function noteJournalWrite(dir, plane, record) {
  const state = journalState(dir);
  state.writes[plane] = (state.writes[plane] || 0) + 1;
  const hashes = state.hashes[plane] ||= [];
  hashes.push({ sequence: state.writes[plane], digest: createHash("sha256").update(JSON.stringify(record)).digest("hex") });
  if (hashes.length > 4000) hashes.shift();
}
export function noteJournalRotation(dir, plane) {
  const state = journalState(dir);
  state.rotations[plane] = (state.rotations[plane] || 0) + 1;
}
export function noteJournalFault(dir, planes) {
  const state = journalState(dir);
  for (const plane of planes) state.faults[plane] = (state.faults[plane] || 0) + 1;
}
export function registerJournalProducer(producer, dir, planes) {
  producers.set(producer, { dir: keyFor(dir), planes });
  for (const plane of planes) journalState(dir).owners.add(plane);
  return producer;
}
export function journalProducer(producer) { return producers.get(producer) || null; }
// Only bootstrap code calls this. HTTP input cannot enroll a runtime or supply
// coverage, owner, dates or file bounds. Isolated mounts remain isolated.
export function registerCommerceRuntime(app, runtime) {
  runtimes.set(app, Object.freeze({ ...runtime }));
}
export function commerceRuntime(app) { return runtimes.get(app) || { entrypoint: 'isolated_express_mount', deploymentId: null, source: null }; }
