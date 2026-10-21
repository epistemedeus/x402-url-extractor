import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { bindJob, PROVIDER } from './fulfill.mjs';
import { receiveCatalog, selectClientRequirement, configureSettlementProofDelivery } from './configured.mjs';
import { openDeliveryJournal } from './journal.mjs';

const check = (ok, message) => { if (!ok) throw Error(message); };
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const digest = value => createHash('sha256').update(value).digest('hex');
export function validJobId(id) { return typeof id === 'string' && /^[1-9][0-9]{0,77}$/.test(id) && BigInt(id) < 2n ** 256n; }

/** Authenticated history is a snapshot, never a socket-derived authority. */
export function receiveHistory(entries, jobId) {
  check(Array.isArray(entries) && entries.length > 0 && entries.length <= 1000 && Buffer.byteLength(JSON.stringify(entries)) <= 1024 * 1024, 'Bounded original history required');
  for (const entry of entries) check(entry.chainId === 8453 && entry.onChainJobId === jobId && Number.isSafeInteger(entry.timestamp) && entry.timestamp > 0, 'History identity mismatch');
  const creations = entries.filter(e => e.kind === 'system' && e.event?.type === 'job.created');
  check(creations.length === 1, 'Exactly one original creation required');
  const created = creations[0].event;
  check(created.jobId === jobId && sameAddress(created.provider, PROVIDER), 'Original provider creation required');
  return created;
}

function freshBinding(session, job, entries, allowUnquoted) {
  check(session.chainId === 8453 && validJobId(session.jobId) && session.roles.includes('provider') && [...session.agentAddresses].some(a => sameAddress(a, PROVIDER)), 'Original provider session required');
  const created = receiveHistory(entries, session.jobId);
  check(sameAddress(created.client, job.clientAddress) && sameAddress(created.evaluator, job.evaluatorAddress) && sameAddress(created.hook, job.hookAddress) && BigInt(created.expiredAt) === job.expiredAt, 'Creation/job binding mismatch');
  const selected = selectClientRequirement(entries, session, job);
  return bindJob(session, job, selected.request, selected.source, { allowUnquoted });
}

function hasQuote(entries, id) {
  const quotes = entries.filter(e => e.kind === 'system' && e.event?.type === 'budget.set');
  check(quotes.length <= 1, 'Ambiguous quote history');
  if (!quotes.length) return false;
  check(quotes[0].event.jobId === id && quotes[0].event.amount === 0.005 && !quotes[0].event.fundRequest, 'Unsupported quote history');
  return true;
}

export function retainedJobIds(directory) {
  const names = fs.readdirSync(directory);
  check(names.length <= 4096, 'Operation directory requires owner retention review');
  return [...new Set(names.flatMap(name => {
    const match = /^8453-([1-9][0-9]*)(?:\.quote)?\.json$/.exec(name);
    return match && validJobId(match[1]) ? [match[1]] : [];
  }))];
}

/** One exact-offer lifecycle. The durable implementation and funded delivery are
 * shared with configured.mjs. Quote records retain process intent, not balances. */
export function createOperatingReceiver({ boundary, journalDirectory, client, mode, selectionPolicy, now = () => new Date(), stopped = () => false, evidence = () => {} }) {
  check(['observe', 'serve'].includes(mode), 'Explicit observe or serve mode required');
  check(selectionPolicy === 'provider-name-terms', 'Explicit qualified selection policy required');
  const quotes = openDeliveryJournal(journalDirectory, { phase: 'quote' });
  const deliveries = openDeliveryJournal(journalDirectory);
  const keyFor = id => `acp:8453:${id}`;
  async function snapshot(id) {
    const entries = await boundary.history.getHistory(8453, id);
    receiveHistory(entries, id);
    const session = boundary.session(id, entries);
    const job = await session.fetchJob();
    const binding = freshBinding(session, job, entries, true);
    return { session, job, entries, binding };
  }
  return Object.freeze({
    async run(id) {
      check(validJobId(id), 'Canonical Base job identity required');
      let current = await snapshot(id);
      const key = keyFor(id);
      let quote = await quotes.read(key);
      const delivery = await deliveries.read(key);
      if (!quote && !delivery) receiveCatalog(await boundary.catalog.getAgentByWalletAddress(PROVIDER));
      if (quote) {
        check(quote.schema === 'acp-settlement-proof-quote/v1' && ['prepared', 'sent_unknown', 'received'].includes(quote.state) && isDeepStrictEqual(quote.binding, current.binding) && quote.artifact === '{"amount":0.005}' && quote.artifactSha256 === digest(quote.artifact), 'Retained quote binding/state mismatch');
      }
      const quoted = hasQuote(current.entries, id);
      if (quoted || quote?.state === 'received') check(current.job.budget.rawAmount === 5000n, 'Retained quote fee changed');
      evidence({ stage: 'validated', jobId: id, status: current.job.status, selection: 'provider-name-terms', registryJobAssociation: 'unavailable-in-sdk' });
      if (mode === 'observe') return { state: 'observed', jobStatus: current.job.status, quoteState: quote?.state ?? null, deliveryState: delivery?.state ?? null, quoted };
      if (stopped()) return { state: 'stopping' };
      if (current.job.status === 'OPEN' && !quoted) {
        check(current.session.status === 'open', 'History/job status disagreement');
        check(current.job.expiredAt > BigInt(Math.floor(now().getTime() / 1000)), 'Expired job cannot be quoted');
        if (!quote) {
          const artifact = '{"amount":0.005}';
          quote = { schema: 'acp-settlement-proof-quote/v1', binding: current.binding, artifact, artifactSha256: digest(artifact), state: 'prepared' };
          check(await quotes.compareAndSet(key, null, quote), 'Concurrent quote preparation; receive original operation');
        }
        if (quote.state === 'prepared') {
          current = await snapshot(id);
          check(isDeepStrictEqual(current.binding, quote.binding) && current.job.status === 'OPEN' && current.session.status === 'open' && !hasQuote(current.entries, id), 'Pre-quote job changed');
          if (stopped()) return { state: 'stopping' };
          const unknown = { ...quote, state: 'sent_unknown' };
          check(await quotes.compareAndSet(key, quote, unknown), 'Concurrent quote dispatch; receive original operation');
          quote = unknown;
          evidence({ stage: 'quote_sent_unknown', jobId: id });
          try { await current.session.executeTool('setBudget', { amount: 0.005 }); } catch { /* durable quarantine; never resend */ }
          try { current = await snapshot(id); } catch { return quote; }
        }
      }
      if (quote?.state === 'sent_unknown') {
        check(isDeepStrictEqual(current.binding, quote.binding), 'Quote readback binding changed');
        if (current.job.budget.rawAmount !== 5000n || !hasQuote(current.entries, id)) return quote;
        const received = { ...quote, state: 'received' };
        if (await quotes.compareAndSet(key, quote, received)) quote = received;
        else quote = await quotes.read(key);
        evidence({ stage: 'quote_received', jobId: id });
      }
      // Never manufacture a quote observation from FUNDED alone. Existing funded
      // obligations can still use the received configured delivery policy.
      if (quote && quote.state !== 'received') return quote;
      if (current.job.status === 'FUNDED' || delivery) {
        check(current.job.budget.rawAmount === 5000n, 'Funded fee mismatch');
        if (!delivery) check(current.job.expiredAt > BigInt(Math.floor(now().getTime() / 1000)), 'Expired job cannot be submitted');
        if (stopped()) return { state: 'stopping' };
        evidence({ stage: 'funded_or_retained_delivery', jobId: id });
        const guardedSession = boundary.session(id, current.entries);
        // Refresh history on every configured read, including before submit.
        const history = { async getHistory(chain, job) {
          const entries = await boundary.history.getHistory(chain, job);
          receiveHistory(entries, id);
          const jobNow = await guardedSession.fetchJob();
          check(isDeepStrictEqual(freshBinding(guardedSession, jobNow, entries, false), current.binding), 'Operating delivery binding changed');
          guardedSession.entries.splice(0, guardedSession.entries.length, ...entries);
          return entries;
        } };
        const result = await configureSettlementProofDelivery({ session: guardedSession, history, catalog: boundary.catalog, journalDirectory, client, now, selectionPolicy }).run();
        evidence({ stage: `delivery_${result.state}`, jobId: id, artifactSha256: result.artifactSha256 });
        return result;
      }
      return { state: quoted || quote?.state === 'received' ? 'awaiting_funding' : 'inactive', jobStatus: current.job.status };
    },
  });
}
