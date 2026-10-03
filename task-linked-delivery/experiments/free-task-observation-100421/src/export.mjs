import { digest, bytesDigest, checkTree, fail, LIMITS } from '../vendor/bounds.mjs';
import { stripRecord as nativeStrip, time, parseNdjson } from '../vendor/task-demand-export.mjs';
import { FREE_EXPORT, HEX, OPERATION, predicateDescriptor, receiptEvidence, ROUTE, TASK, UUID, validEvidence, verifyReplay } from './receipt.mjs';
export { time, parseNdjson };
export const SOURCE_SCHEMA = 'samedaydesk.free-task-observation.source.v1';
export const BASE_COMMIT = '519645af3a2fa36f745d59f08aab4008776a4aa6';
export const PLANES = ['attempts','task_refs','forward','retention','reads','settlements'];
const pick = (r, keys) => Object.fromEntries(keys.map(k => [k,r[k]]));
const only = (v,keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const OBS_KEYS = ['authority','commerceEventId','capturedAt','observedAt','responseDigest','responseByteLength','evidence','predicate','callerClaim','requestDigest','replay','independent'];
const ROW_KEYS = ['schema','action','grantId','recordId','resultId','commerceEventId','operationId','cohort','taskRef','createdAt','expiresAt','method','route','observation'];
export function validFreeRetention(r) {
  if (!only(r,ROW_KEYS) || r.schema !== FREE_EXPORT || r.action !== 'retain'
    || !/^[a-f0-9]{16}$/.test(r.grantId || '') || !/^[a-f0-9]{32}$/.test(r.recordId || '')
    || !HEX.test(r.resultId || '') || r.recordId !== r.resultId.slice(0,32)
    || !UUID.test(r.commerceEventId || '') || !TASK.test(r.taskRef || '')
    || r.operationId !== OPERATION || !['owner_qa','controlled_test','external_unknown','sponsored_trial'].includes(r.cohort)
    || r.method !== 'GET' || r.route !== ROUTE || ![r.createdAt,r.expiresAt].every(time)
    || Date.parse(r.expiresAt) <= Date.parse(r.createdAt)) return false;
  const o = r.observation;
  if (!only(o,OBS_KEYS) || Object.keys(o).length !== OBS_KEYS.length
    || o.authority !== 'authorized_caller_received_bytes' || o.commerceEventId !== r.commerceEventId
    || !HEX.test(o.responseDigest || '') || !HEX.test(o.requestDigest || '') || ![o.capturedAt,o.observedAt].every(time)
    || o.observedAt !== r.createdAt || Date.parse(o.observedAt) < Date.parse(o.capturedAt)
    || !Number.isSafeInteger(o.responseByteLength) || o.responseByteLength < 1 || o.responseByteLength > 12_288
    || !validEvidence(o.evidence) || ![null,true,false].includes(o.callerClaim)) return false;
  try {predicateDescriptor(o.predicate);} catch {return false;}
  if (o.replay !== null && (!only(o.replay,['authority','evidence','provenance']) || o.replay.authority !== 'separate_receipt_execution'
    || !['fixture_rpc','explicit_observation_port'].includes(o.replay.provenance) || !validEvidence(o.replay.evidence))) return false;
  return digest(verifyReplay(o.evidence,o.predicate,o.replay)) === digest(o.independent);
}
export function stripRecord(row, plane) {
  if (plane === 'retention' && row?.evidenceClass === 'free_observed_delivery') {
    if (row.schema !== 'samedaydesk.useful-result-reuse.customer-grant.v1' || row.action !== 'retain'
      || row.taskJoin !== 'bound' || row.paidValidDelivery !== false || row.paymentPermitted !== false
      || row.settlementStatus !== 'unknown' || row.settlementDigest !== null || !row.body || !row.observation
      || digest(row.body) !== row.resultId || !receiptEvidence(row.body) || !row.observation.evidence
      || digest(receiptEvidence(row.body)) !== digest(row.observation.evidence)) return null;
    const stripped = { ...pick(row,ROW_KEYS.filter(k => k !== 'schema')), schema:FREE_EXPORT };
    return validFreeRetention(stripped) ? stripped : null;
  }
  if (plane === 'retention' && validFreeRetention(row)) return structuredClone(row);
  return nativeStrip(row,plane);
}
export function validStripped(row,plane) {
  const s = stripRecord(row,plane);
  return s !== null && digest(s) === digest(row);
}
export function validateSource(s) {
  if (!only(s,['schema','id','plane','kind','populationId','scope','from','to','asOf','coverage','producerCommit','records','intake'])
    || s.schema !== SOURCE_SCHEMA || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.id || '')
    || !PLANES.includes(s.plane) || !['synthetic_fixture','supported_read_only_export'].includes(s.kind)
    || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(s.populationId || '') || s.producerCommit !== BASE_COMMIT
    || !['complete','partial','unknown'].includes(s.coverage) || ![s.from,s.to,s.asOf].every(time)
    || Date.parse(s.from) >= Date.parse(s.to) || Date.parse(s.asOf) < Date.parse(s.to)
    || !Array.isArray(s.records) || s.records.length > LIMITS.rows) fail('source_rejected');
  if (!only(s.scope,['operationIds','cohorts','taskRefs']) || !Array.isArray(s.scope.operationIds) || s.scope.operationIds.length !== 1
    || s.scope.operationIds[0] !== OPERATION || !Array.isArray(s.scope.cohorts) || !s.scope.cohorts.length
    || s.scope.cohorts.some(c => !['owner_qa','controlled_test','external_unknown','sponsored_trial'].includes(c))
    || s.scope.taskRefs !== undefined && (!Array.isArray(s.scope.taskRefs) || !s.scope.taskRefs.length || s.scope.taskRefs.some(t => !TASK.test(t)))) fail('source_scope_rejected');
  if (!only(s.intake,['rawBytes','rawSha256','malformed','torn','rejected']) || !HEX.test(s.intake.rawSha256 || '')
    || !['rawBytes','malformed','torn','rejected'].every(k => Number.isSafeInteger(s.intake[k]) && s.intake[k] >= 0)
    || s.intake.rawBytes > LIMITS.fileBytes) fail('intake_rejected');
  return s;
}
export function exportSource({metadata,records,rawBytes=null,malformed=0,torn=0}) {
  checkTree(records);
  if (!Array.isArray(records) || records.length > LIMITS.rows) fail('record_limit_exceeded');
  const projected=[];let rejected=0;
  for (const r of records) {const s=stripRecord(r,metadata.plane);if(s) projected.push(s);else rejected++;}
  const bytes = rawBytes || Buffer.from(JSON.stringify(records));
  if (bytes.length > LIMITS.fileBytes) fail('input_bytes_exceeded');
  return validateSource({...metadata,schema:SOURCE_SCHEMA,producerCommit:BASE_COMMIT,records:projected,
    intake:{rawBytes:bytes.length,rawSha256:bytesDigest(bytes),malformed,torn,rejected}});
}
