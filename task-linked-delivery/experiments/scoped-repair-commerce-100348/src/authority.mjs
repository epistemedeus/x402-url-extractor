import { createIntent, createPlan, digest, normalizeRequest, verifyAuthorization, verifyExecutionAuthorization } from 'agent-payment-policy';
import { acceptanceAction, evaluateAcceptance } from './contracts.mjs';

export const AUDIT_PRICE = '10000';
export const AUDIT_ROUTE = '/commerce/seller-integrity-audit';
const no = reason => ({ status: 'withheld', reason, authorized: false, paymentPerformed: false });

export function quoteFor(request, binding, offer, now,expectedUrl) {
  if (!request.quoteIntent) return no('quote_not_requested');
  if (request.kind !== 'seller' || request.input.question !== 'declaration_contract') return no('existing_audit_is_not_this_scope');
  if (!offer) return no('current_offer_unavailable');
  if(Object.hasOwn(offer,'body'))return no('quote_operation_binding_changed');
  offer = Object.fromEntries(['method','url','protocol','amountAtomic','recipient','network','asset','expiresAt'].map(k => [k,offer[k]]));
  if (offer.amountAtomic !== AUDIT_PRICE || new URL(offer.url).pathname !== AUDIT_ROUTE || offer.method !== 'GET') return no('existing_price_or_route_changed');
  if(!expectedUrl||digest(normalizeRequest('GET',expectedUrl))!==digest(normalizeRequest(offer.method,offer.url)))return no('quote_operation_binding_changed');
  const intent = createIntent({ purposeId: request.task.id, needDigest: binding.digest,
    output: { requiredFields: ['report.responseContract','report.repairPlan','report.findings'], maxResponseBytes: 100000 },
    economics: request.quoteIntent.economics, policy: request.quoteIntent.policy }, { now, ttlMs: 300000 });
  const plan = createPlan({ intent, offers: [offer], now });
  return { status: plan.selected ? 'candidate' : 'withheld', reason: plan.decision, authorized: false, priceAtomic: AUDIT_PRICE,
    scope: 'existing_seller_audit_only', implementationPriceAtomic: null, paymentPerformed: false, intent, plan, offer };
}

export function checkAcceptance(packet, command, { publicKey, currentOffer, now = Date.now() } = {}) {
  const denied = reason => ({ decision: command?.decision || 'unknown', authorized: false, reason, paidAuthorizationVerified: false,
    observedWork: evaluateAcceptance(packet), settlement: 'unknown', paymentPerformed: false });
  if (command?.taskId !== packet.binding.task.id || command?.callerId !== packet.binding.task.callerId) return denied('wrong_task_or_owner');
  if (command?.decision === 'declined') return denied('claimant_declined');
  if (command?.decision !== 'accepted') return denied('explicit_acceptance_required');
  if (!evaluateAcceptance(packet).passed) return denied('work_predicate_failed');
  if (!publicKey) return denied('acceptance_authority_unavailable');
  const quote = packet.quote;
  if (quote?.status !== 'candidate' || !quote.plan?.selected) return denied('no_existing_paid_quote');
  if (!currentOffer) return denied('current_offer_unavailable');
  try {
    const plan = quote.plan, selected = plan.selected;
    if (digest(Object.fromEntries(Object.entries(plan).filter(([k]) => k !== 'planId'))) !== plan.planId || plan.purposeId !== command.taskId || quote.intent.needDigest !== packet.binding.digest) return denied('quote_binding_changed');
    if (Date.parse(quote.intent.expiresAt) <= now || Date.parse(selected.expiresAt) <= now) return denied('quote_expired');
    const current = normalizeRequest(currentOffer.method, currentOffer.url, Object.hasOwn(currentOffer, 'body') ? { body: currentOffer.body } : {});
    if (digest(current) !== digest(selected.request) || ['protocol','amountAtomic','recipient','network','asset','expiresAt'].some(k => currentOffer[k] !== selected[k]) || currentOffer.amountAtomic !== AUDIT_PRICE) return denied('current_terms_changed');
    const authorization = verifyAuthorization(command.authorization, { publicKey, plan, now });
    // The received 0.12 verifier checks amount/recipient; also compare its
    // network and asset to the current exact quote before action verification.
    if (['protocol','network','asset','recipient'].some(k => authorization[k] !== selected[k]) || authorization.maxAmountAtomic !== selected.amountAtomic) return denied('authorization_terms_changed');
    verifyExecutionAuthorization(command.executionAuthorization, { publicKey, authorization, method: 'accept_delivery', network: selected.network,
      action: acceptanceAction(packet), now });
    return { decision: 'accepted', authorized: true, reason: 'exact_existing_authorization_and_action', paidAuthorizationVerified: true,
      scope: 'acceptance_of_this_packet', observedWork: evaluateAcceptance(packet), settlement: 'unknown', paymentPerformed: false,
      executionPermittedByPackage: false, additionalImplementationAuthorized: false };
  } catch (error) { return denied(/currently valid|expired/.test(error.message) ? 'grant_expired' : 'authorization_refused'); }
}
