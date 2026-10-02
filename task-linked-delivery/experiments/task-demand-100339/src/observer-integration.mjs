import { BASE_COMMIT, BUNDLE_SCHEMA, projectBundle, validateSource } from './project.mjs';
import { EXPORT_SCHEMA, exportRecords, stripRecord } from './export.mjs';
import { budget, bytesDigest, digest, fail, LIMITS } from './bounds.mjs';

// Isolated adapter for the existing observer's explicitly supplied records.
// Root may call this after obtaining its supported read-only cut. No mount,
// journal write, new metric store, credential, network request or private-dir read.
export function exportObserverSource({ metadata, records, rawBytes = null, malformed = 0, torn = 0 }, { tick = budget() } = {}) {
  exportRecords(records, tick);
  const stripped = []; let rejected = 0;
  for (const row of records) {
    tick(); const projected = stripRecord(row, metadata.plane);
    if (projected) stripped.push(projected); else rejected++;
  }
  if (rawBytes !== null && rawBytes.length > LIMITS.fileBytes) fail('input_bytes_exceeded');
  const input = rawBytes || Buffer.from(JSON.stringify(records));
  if (input.length > LIMITS.fileBytes) fail('input_bytes_exceeded');
  const source = { ...metadata, schema: EXPORT_SCHEMA, producerCommit: BASE_COMMIT, records: stripped,
    intake: { rawBytes: input.length, rawSha256: bytesDigest(input), malformed, torn, rejected } };
  validateSource(source);
  return source;
}
export function projectObserverEvidence({ question, sources, economics }, options) {
  return projectBundle({ schema: BUNDLE_SCHEMA, question, sources, ...(economics ? { economics } : {}) }, options);
}
export function describeObserverIntegration() {
  return { module: 'task-linked-delivery/experiments/task-demand-100339/src/observer-integration.mjs',
    entrypoint: 'projectObserverEvidence', exportEntrypoint: 'exportObserverSource',
    readOnly: true, sharedRouteOwner: 'Root', sourceContractDigest: digest({ base: BASE_COMMIT, contract: EXPORT_SCHEMA }),
    aggregatePolicy: 'Existing public snapshots may be retained as dated context but supply no task denominator.' };
}
