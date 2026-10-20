import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { BASE_USDC, normalizeSettlementProofInput, settlementProof, settlementProofMcpOutputSchema } from '../../settlement-proof.mjs';

export const OFFERING_ID = '019ff030-09d4-7456-91b5-213ec48246b7';
export const PROVIDER = '0x561901cf20080e2bed6802ce718c4a17008a1ca2';
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const requirementSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  recipient: address,
  amountAtomic: z.string().regex(/^[1-9][0-9]*$/).max(21),
  payer: address.optional(),
}).strict();
const digest = value => createHash('sha256').update(value).digest('hex');
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function requireThat(condition, message) { if (!condition) throw new Error(message); }

export function validateRequirement(requirements) {
  // Do not inherit the SDK's object-only validation dispatch or reader coercion.
  const parsed = requirementSchema.parse(requirements);
  return normalizeSettlementProofInput(parsed);
}

function sessionKey(session, offeringId) {
  requireThat(offeringId === OFFERING_ID, 'Original Settlement Proof offering binding required');
  requireThat(session.chainId === 8453 && typeof session.jobId === 'string' && /^[1-9][0-9]*$/.test(session.jobId), 'Canonical Base job identity required');
  requireThat(session.roles.includes('provider') && [...session.agentAddresses].some(a => sameAddress(a, PROVIDER)), 'Original provider role required');
  return `acp:8453:${session.jobId}`;
}

function bindJob(session, job, request, source) {
  requireThat(job && job.chainId === 8453 && String(job.id) === session.jobId, 'Fetched job identity mismatch');
  requireThat(sameAddress(job.providerAddress, PROVIDER) && job.description === 'Settlement Proof', 'Fetched provider/offering name mismatch');
  requireThat(job.budget?.rawAmount === 5000n && sameAddress(job.budget.address, BASE_USDC), 'Original 0.005 USDC service price required');
  requireThat(!job.getFundRequestIntent() && job.intents.length === 0 && sameAddress(job.hookAddress, `0x${'0'.repeat(40)}`), 'Working-funds or custom-hook job is outside this offering');
  return {
    offeringId: OFFERING_ID, chainId: 8453, jobId: session.jobId,
    provider: PROVIDER, client: job.clientAddress, evaluator: job.evaluatorAddress,
    description: job.description, expiredAt: String(job.expiredAt), hookAddress: job.hookAddress,
    servicePriceAtomic: '5000', asset: BASE_USDC, request,
    ...(source === undefined ? {} : { source }),
  };
}

function checkRecord(record, binding) {
  requireThat(record?.schema === 'acp-settlement-proof-delivery/v1', 'Invalid retained operation');
  requireThat(isDeepStrictEqual(record.binding, binding), 'Original job/request binding changed');
  requireThat(['prepared', 'sent_unknown', 'received'].includes(record.state), 'Invalid retained operation state');
  requireThat(typeof record.artifact === 'string' && digest(record.artifact) === record.artifactSha256, 'Retained artifact digest mismatch');
  const result = settlementProofMcpOutputSchema.parse(JSON.parse(record.artifact));
  requireThat(isDeepStrictEqual(result.request, binding.request), 'Retained artifact request mismatch');
  requireThat(sameAddress(result.asset.address, BASE_USDC) && result.transaction.hash === binding.request.transactionHash, 'Retained artifact asset/transaction mismatch');
}

function canSubmit(session, job) {
  requireThat(job.status === 'FUNDED' && session.status === 'funded' && session.availableTools().some(t => t.name === 'submit'), 'Funded provider job required');
}

/**
 * One offering, one original job, one retained artifact. No default transport,
 * signer, store, listener, job creation or funding. journal is an adapter onto
 * the caller's existing job record: read(key), compareAndSet(key, old, next).
 * CAS must atomically persist before resolving, including across processes.
 */
export async function fulfillAcpSettlementProof({ session, offeringId, requirements, journal, client, now, bindSource }) {
  const request = validateRequirement(requirements);
  const key = sessionKey(session, offeringId);
  requireThat(journal && typeof journal.read === 'function' && typeof journal.compareAndSet === 'function', 'Existing durable job journal required');
  let job = await session.fetchJob();
  const bindingFor = async job => bindJob(session, job, request, bindSource ? await bindSource(job) : undefined);
  const binding = await bindingFor(job);
  let record = await journal.read(key);
  if (!record) {
    canSubmit(session, job);
    const result = await settlementProof(request, { client, now });
    const artifact = JSON.stringify(settlementProofMcpOutputSchema.parse(result));
    record = { schema: 'acp-settlement-proof-delivery/v1', binding, artifact, artifactSha256: digest(artifact), state: 'prepared' };
    requireThat(await journal.compareAndSet(key, null, record), 'Concurrent preparation; receive original job operation');
  }
  checkRecord(record, binding);
  if (record.state === 'received') return record;
  if (record.state === 'prepared') {
    // Receipt RPC can take time; recheck the original job immediately before
    // claiming the one dispatch. SDK/chain guards still own concurrent changes.
    job = await session.fetchJob();
    requireThat(isDeepStrictEqual(await bindingFor(job), binding), 'Pre-send job binding changed');
    canSubmit(session, job);
    const sent = { ...record, state: 'sent_unknown' };
    // Durable uncertainty precedes the SDK's HTTP POST and financial submission.
    requireThat(await journal.compareAndSet(key, record, sent), 'Concurrent dispatch; receive original job operation');
    record = sent;
    try {
      await session.executeTool('submit', { deliverable: record.artifact });
    } catch {
      // A POST can succeed before signing/broadcast fails or its response is lost.
      // No re-execution from sent_unknown, even if current state still says funded.
    }
    try { job = await session.fetchJob(); } catch { return record; }
  }
  // On re-entry sent_unknown only reads. HTTP artifact storage alone is not the
  // chain transition: require both submitted/completed state and exact bytes.
  requireThat(isDeepStrictEqual(await bindingFor(job), binding), 'Readback job binding changed');
  if (!['SUBMITTED', 'COMPLETED'].includes(job.status) || job.deliverable !== record.artifact) return record;
  const received = { ...record, state: 'received' };
  requireThat(await journal.compareAndSet(key, record, received), 'Concurrent receiving; read original job operation');
  return received;
}
