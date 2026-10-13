// Independent fixture oracle; receiver uses the unchanged file/JSON interface.
// Does not import the producer, its summary function or its normalizers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export function receive(queue, expected, handback, queueBytes) {
  const encode = v => Array.isArray(v) ? `[${v.map(encode).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${encode(v[k])}`).join(',')}}` : JSON.stringify(v);
  const digest = v => createHash('sha256').update(encode(v)).digest('hex');
  assert.equal(handback.schemaVersion, 1);
  assert.equal(handback.synthetic, true);
  assert.equal(handback.queueId, expected.queueId);
  assert.equal(handback.queueId, queue.queueId);
  assert.equal(handback.queueSha256, createHash('sha256').update(queueBytes).digest('hex'));
  assert.equal(handback.recipeCommit, '32267493d29ff1339c5199185d8231012daf0acd');
  assert.equal(handback.exit, 'finite_handback_complete');
  assert.equal(handback.paymentExecuted, false);
  assert.equal(handback.renewed, false);
  assert.deepEqual(handback.support, queue.support);
  assert.equal(handback.results.length, expected.cases.length);
  const seen = new Set();
  let accepted = 0, rows = 0;
  for (const r of handback.results) {
    assert.equal(seen.has(r.inputId), false, 'duplicate_result'); seen.add(r.inputId);
    const want = expected.cases.find(c => c.inputId === r.inputId);
    const input = queue.inputs.find(i => i.inputId === r.inputId);
    assert.ok(want && input, 'foreign_result');
    const { receiptDigest, ...payload } = r;
    assert.equal(receiptDigest, digest(payload)); assert.equal(r.inputDigest, digest(input));
    assert.equal(r.qualificationDigest, digest({ callerId: input.callerId, taskId: input.taskId, inputId: input.inputId, source: input.source, predicate: input.predicate }));
    assert.equal(r.callerId, input.callerId); assert.equal(r.taskId, input.taskId);
    assert.deepEqual(r.lineage, { source: input.source, predicate: input.predicate,
      freshnessNeed: input.freshnessNeed ?? null, snapshot: input.snapshot });
    assert.deepEqual(r.acquired, { bytes: input.snapshot.bytes, sha256: input.snapshot.sha256, verified: true });
    assert.equal(r.status, want.status); assert.equal(r.accepted, want.accepted);
    assert.equal(r.due, want.due); assert.equal(r.coverage.status, want.coverageStatus);
    assert.deepEqual(r.rows.map(x => x.title), want.selectedTitles);
    assert.deepEqual(r.rows.map(x => x.url), want.selectedUrls);
    assert.equal(r.unknownRows.length, want.unknownLocations);
    assert.equal(r.coverage.missing.length, want.missingRows);
    assert.equal(r.coverage.uniqueRows, want.uniqueRows);
    assert.equal(r.coverage.remaining, want.remaining);
    assert.equal(r.coverage.unlistedWithheld ?? 0, want.unlistedWithheld);
    for (const row of r.rows) {
      assert.equal(row.location, 'Remote US');
      assert.equal(row.source, input.source.reader === 'acxiom'
        ? 'https://acxiomllc.wd5.myworkdayjobs.com/wday/cxs/acxiomllc/AcxiomUSA/jobs'
        : 'https://api.ashbyhq.com/posting-api/job-board/liveramp-inc');
      assert.equal(row.fetchedAt, input.snapshot.acquiredAt);
      assert.equal(row.title.startsWith('Data '), true);
    }
    assert.equal(r.paymentExecuted, false); assert.equal(r.renewed, false);
    assert.equal(r.unresolvedReason, r.accepted ? null : 'incomplete_coverage_or_predicate_fields');
    assert.equal(r.support, r.accepted ? 'finite_answer_delivered' : 'returned_to_caller');
    if (r.accepted) accepted++;
    rows += r.rows.length;
  }
  // Recount actual results; a forged producer summary cannot satisfy the oracle.
  assert.equal(accepted, expected.summary.accepted);
  assert.equal(handback.results.length - accepted, expected.summary.unresolved);
  assert.equal(rows, expected.summary.selectedRows);
  assert.deepEqual(handback.summary, { uniqueInputs: expected.summary.uniqueInputs,
    duplicateQueueEntries: queue.inputs.length - handback.results.length,
    accepted, unresolved: handback.results.length - accepted, selectedRows: rows });
  assert.equal(handback.work.requests, expected.summary.requests);
  assert.equal(handback.work.pages, expected.summary.pages);
  assert.equal(handback.work.snapshotReads, 3);
  assert.equal(handback.work.bytes, queue.inputs.slice(0, 3).reduce((n, i) => n + i.snapshot.bytes, 0));
  assert.equal(handback.work.elapsedMs, 0);
  return { accepted, unresolved: handback.results.length - accepted, selectedRows: rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [queuePath, oraclePath, resultPath, ...extra] = process.argv.slice(2);
    assert.ok(queuePath && oraclePath && resultPath && !extra.length, 'usage: node receive.mjs QUEUE ORACLE HANDBACK');
    const bytes = readFileSync(queuePath);
    console.log(JSON.stringify(receive(JSON.parse(bytes), JSON.parse(readFileSync(oraclePath)), JSON.parse(readFileSync(resultPath)), bytes)));
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
