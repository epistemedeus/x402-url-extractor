import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { paymentOfferPreflight } from '../payment-offer-preflight.mjs';

const fields = ['protocol', 'method', 'url', 'amount', 'network', 'asset', 'recipient'];
const evmAddress = /^0x[0-9a-f]{40}$/i;

// Caller owns the saved baseline and its vetting authority. Never make the
// candidate under inspection the source of those earlier terms.
export async function reviewVettedGetQuote(baseline, options) {
  if (baseline?.method !== 'GET' || baseline?.protocol !== 'x402' || baseline.expiresAt !== undefined ||
      typeof baseline.amountAtomic !== 'string' || !/^[1-9][0-9]{0,77}$/.test(baseline.amountAtomic) ||
      typeof baseline.network !== 'string' || !/^eip155:[1-9][0-9]{0,19}$/.test(baseline.network) ||
      typeof baseline.asset !== 'string' || !evmAddress.test(baseline.asset) ||
      typeof baseline.recipient !== 'string' || !evmAddress.test(baseline.recipient)) {
    throw new Error('Expected an exact x402 GET baseline with atomic amount, EVM network, token and recipient');
  }
  const observed = await paymentOfferPreflight({ url: baseline.url, catalog: baseline }, options);
  const boundary = { baselineVettingVerified: false, timestampProven: false, paymentAuthorized: false, paymentSent: false };
  const result = (decision, reason, changed = [], unverified = []) => ({
    schema: 'samedaydesk.vetted-quote-review.v1', decision, reason, changed, unverified, boundary,
  });
  const candidates = observed.offers.filter(offer => offer.protocol === 'x402');
  if (observed.target.httpStatus !== 402 || candidates.length !== 1 || !candidates[0].valid ||
      candidates[0].scheme !== 'exact' || observed.catalogCoherence.length !== 1) {
    return result('unknown', 'expected_one_exact_x402_challenge');
  }

  const comparison = observed.catalogCoherence[0];
  const changed = comparison.drifted.filter(field => fields.includes(field));
  if (changed.length) return result('review_required', 'saved_terms_differ', changed, comparison.unknown);
  if (comparison.unknown.some(field => field !== 'expiry') || observed.decision !== 'parseable_offer') {
    return result('unknown', 'preflight_not_qualified', [], comparison.unknown);
  }
  return result('observed_terms_match', 'scope_only', [], comparison.unknown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node examples/vetted-quote-review.mjs SAVED-PUBLIC-QUOTE.json');
    const file = await open(process.argv[2], 'r');
    let data;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 8_192) throw new Error('Expected a regular baseline file of at most 8 KiB');
      const buf = Buffer.alloc(8_193);
      const { bytesRead } = await file.read(buf, 0, buf.length, 0);
      if (bytesRead !== stat.size) throw new Error('Baseline changed or was not read completely');
      data = buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await file.close();
    }
    const result = await reviewVettedGetQuote(JSON.parse(data));
    console.log(JSON.stringify(result));
    process.exitCode = result.decision === 'observed_terms_match' ? 0 : 2;
  } catch {
    console.error('Quote review could not complete. Check the public baseline, exact GET and transport.');
    process.exitCode = 1;
  }
}
