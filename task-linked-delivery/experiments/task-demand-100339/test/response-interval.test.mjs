import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBundle, replayRetained, retainReport } from '../src/project.mjs';
import { stripRecord } from '../src/export.mjs';
import { fixture, plane } from './fixtures.mjs';

test('native retention during response uses measured duration and survives portable replay', () => {
  const bundle = fixture(), event = plane(bundle, 'attempts').records[0], retain = plane(bundle, 'retention').records[0];
  event.durationMs = 2000;
  retain.createdAt = new Date(Date.parse(event.ts) - 1000).toISOString();
  const report = projectBundle(bundle);
  assert.equal(report.journeys[0].stages.valid_delivery.timing, 'retention_created_during_causal_response');
  assert.equal(report.journeys[0].stages.retention.status, 'observed');
  assert.equal(report.journeys[0].stages.later_use.status, 'observed');
  assert.deepEqual(replayRetained(retainReport(bundle, report)), report);
  delete event.durationMs;
  assert.equal(projectBundle(bundle).journeys[0].stages.retention.status, 'unknown');
  event.durationMs = 999;
  assert.equal(projectBundle(bundle).journeys[0].stages.retention.status, 'unknown');
});

test('measured response duration rejects invalid values and does not replace causal ownership', () => {
  const bundle = fixture(), event = plane(bundle, 'attempts').records[0];
  for (const durationMs of [-1, 1.5, '2000', Number.MAX_SAFE_INTEGER, null])
    assert.equal(stripRecord({ ...event, durationMs }, 'attempts'), null);
  assert.equal(stripRecord({ ...event, durationMs: 0 }, 'attempts').durationMs, 0);
  event.durationMs = 1000;
  plane(bundle, 'task_refs').records.shift();
  const report = projectBundle(bundle);
  assert.equal(report.denominator.covered, false);
  assert.equal(report.groups.owner_internal.counts.retention, 0);
});
