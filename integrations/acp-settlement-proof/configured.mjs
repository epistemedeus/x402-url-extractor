import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fulfillAcpSettlementProof, validateRequirement, OFFERING_ID, PROVIDER } from './fulfill.mjs';
import { openDeliveryJournal } from './journal.mjs';

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function requireThat(ok, message) { if (!ok) throw Error(message); }

export function selectClientRequirement(entries, session, job) {
  requireThat(Array.isArray(entries), 'Complete original job history required');
  const requirements = entries.filter(e => e.kind === 'message' && e.contentType === 'requirement');
  requireThat(requirements.length === 1, 'Exactly one original requirement required');
  const message = requirements[0];
  requireThat(message.chainId === 8453 && message.onChainJobId === session.jobId, 'Requirement job identity mismatch');
  requireThat(sameAddress(message.from, job.clientAddress), 'Original client requirement sender required');
  requireThat(message.packageId === undefined, 'Subscription requirement unsupported');
  requireThat(Number.isSafeInteger(message.timestamp) && message.timestamp > 0 && typeof message.content === 'string' && Buffer.byteLength(message.content) <= 16384, 'Invalid requirement message');
  const request = JSON.parse(message.content);
  validateRequirement(request);
  // No stable message ID exists in SDK0.1.15. This digest binds exact observed
  // bytes and sender/time, and never purports to authenticate them independently.
  const source = {
    selection: 'configured-provider-name-terms/v1',
    registryOfferingId: OFFERING_ID,
    registryJobAssociation: 'unavailable-in-sdk',
    slaMinutes: 1440,
    message: { chainId: 8453, jobId: session.jobId, from: message.from.toLowerCase(), timestamp: message.timestamp, contentType: 'requirement', content: message.content },
    contentSha256: createHash('sha256').update(message.content).digest('hex'),
  };
  return { request, source };
}

function receiveCatalog(detail) {
  requireThat(detail && sameAddress(detail.walletAddress, PROVIDER), 'Original provider catalog required');
  const matches = detail.offerings?.filter(o => o.name === 'Settlement Proof') ?? [];
  requireThat(matches.length === 1, 'Unique configured offering required');
  const offer = matches[0];
  requireThat(offer.id === OFFERING_ID && offer.priceType === 'fixed' && offer.priceValue === 0.005 && offer.slaMinutes === 1440 && offer.requiredFunds === false && !offer.subscriptions?.length, 'Unsupported offering terms');
}

/** Root supplies existing session + authenticated history/catalog clients. No
 * credentials, signer, provider, listener or live transport is constructed here.
 * Selection is explicitly provider/name/terms policy, never registry entitlement.
 */
export function configureSettlementProofDelivery({ session, history, catalog, journalDirectory, client, now, selectionPolicy }) {
  requireThat(selectionPolicy === 'provider-name-terms', 'Explicit provider-name-terms policy required; SDK cannot prove registry job entitlement');
  function requireSession() {
    requireThat(session?.chainId === 8453 && typeof session.jobId === 'string' && /^[1-9][0-9]{0,77}$/.test(session.jobId) && BigInt(session.jobId) < 2n ** 256n && session.roles?.includes('provider') && [...session.agentAddresses].some(a => sameAddress(a, PROVIDER)), 'Existing original provider session required');
  }
  requireSession();
  const jobId = session.jobId;
  function requireOriginalSession() { requireSession(); requireThat(session.jobId === jobId, 'Configured original session identity changed'); }
  requireThat(typeof history?.getHistory === 'function' && typeof catalog?.getAgentByWalletAddress === 'function', 'Explicit history and catalog clients required');
  requireThat(client && typeof client.getTransactionReceipt === 'function' && typeof client.getBlock === 'function', 'Explicit receipt RPC client required');
  const journal = openDeliveryJournal(journalDirectory);
  const key = `acp:8453:${jobId}`;
  return Object.freeze({
    async run() {
      requireOriginalSession();
      // Existing obligations are received against retained terms, even when the
      // public catalog changes later. The job/message binding is always fresh.
      if (!await journal.read(key)) receiveCatalog(await catalog.getAgentByWalletAddress(PROVIDER));
      const initial = selectClientRequirement(await history.getHistory(8453, session.jobId), session, await session.fetchJob());
      return fulfillAcpSettlementProof({ session, offeringId: OFFERING_ID, requirements: initial.request, journal, client, now,
        async bindSource(job) {
          requireOriginalSession();
          const fresh = selectClientRequirement(await history.getHistory(8453, session.jobId), session, job);
          requireThat(isDeepStrictEqual(fresh, initial), 'Original requirement changed during delivery');
          return fresh.source;
        },
      });
    },
  });
}
