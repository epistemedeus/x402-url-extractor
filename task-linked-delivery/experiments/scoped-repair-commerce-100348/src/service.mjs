import { performance } from 'node:perf_hooks';
import { allowance, fail } from './bounds.mjs';
import { digest, evaluateAcceptance, PACKET, RECORD, sealPacket, validateRequest, verifyPacket } from './contracts.mjs';
import { checkAcceptance, quoteFor } from './authority.mjs';
import { auditUrl, ownerInput, projectObserverEvidence, sellerRun, surfaceRun } from './owners.mjs';
import { packetAccess } from './packet-store.mjs';

const FILE = 'scoped-repair-packets.ndjson';
const no = reason => ({ status: 'unknown', reason });
export const nextAction = 'Supply the exact caller task, operation, selected output or concern, current terms, and bounded inputs.';
function summary(report) {
  if (!report) return null;
  return { taskId: report.taskId, concern: report.concern, scanPerformed: report.scanPerformed, scanner: report.scanner,
    scannerExit: report.scannerExit, findings: report.findings, examined: report.examined, measurement: report.measurement,
    blanketSafetyScore: null, universalGuarantee: false };
}

export function createScopedRepairService({ store = null, skillguardRoot = null, retention = null, regressionFor = null,
  offerFor = null, evidenceFor = null, publicKeys = new Map(), now = () => Date.now() } = {}) {
  const packets=store?packetAccess(store,FILE):null;
  async function stored(packetId, budget) {
    if (!store) fail('delivery_store_unavailable');
    const rows = await budget.wait(packets.read(budget));
    const matches = rows.filter(row => row.schema === RECORD && row.packet?.packetId === packetId);
    if (matches.length !== 1) fail(matches.length ? 'ambiguous_packet' : 'packet_not_found');
    return verifyPacket(matches[0].packet);
  }
  async function currentRegression(request, binding, budget, prior = null) {
    if (request.kind !== 'surface' || !regressionFor || !retention) return { authorized: false, reason: 'retention_not_enrolled', paymentPermitted: false };
    const known = prior || await budget.wait(Promise.resolve(regressionFor(binding)));
    if (!known?.id) return { authorized: false, reason: 'no_current_shared_regression', paymentPermitted: false };
    const input = request.fix?.request || request.input;
    const decision = await budget.wait(retention.read(known.id, { contextId: input.contextId || request.task.id, files: input.files, retained: known.record || null, budget }));
    return { authorized: decision.authorized === true, reason: decision.reason || null, id: known.id,
      record: decision.record || null, regression: decision.regression || null, paymentPermitted: false, rewardInherited: false };
  }
  async function fresh(request, binding, budget, prior = null) {
    const started = performance.now();
    let baseline, observed, regression = null, qualification, reason, artifact = null;
    if (request.kind === 'surface') {
      const result = await surfaceRun(request, budget, skillguardRoot);
      baseline = { kind: 'direct_free_scan', report: summary(result.baseline), priceAtomic: '0' };
      const after = result.retest?.current || result.baseline;
      observed = { independent: after?.scanPerformed === true, result: after?.concern?.result || 'unknown',
        comparison: result.retest?.comparison || null, report: summary(after), useful: after?.concern?.result === 'no_match' };
      const before = result.baseline?.concern?.result;
      if (before === 'no_match') { qualification = 'free_already_sufficient'; reason = 'selected_concern_already_absent'; }
      else if (result.retest?.comparison === 'fixed') { qualification = 'compatible_reusable_fix'; reason = 'original_and_changed_bytes_retested'; }
      else if (request.implementation && result.baseline?.scanPerformed) { qualification = 'explicit_new_scoped_implementation_need'; reason = 'caller_requested_additional_scope'; }
      else { qualification = 'missing_task_input'; reason = result.reason || 'changed_bytes_or_explicit_scope_required'; }
      regression = await currentRegression(request, binding, budget, prior?.regression);
    } else {
      const result = await sellerRun(request, budget, prior?.artifact);
      const receipt = result.receipt;
      const repair = receipt?.retest;
      baseline = { kind: 'direct_free_seller_client_0.4.1', priceAtomic: '0', classification: receipt?.classification || null,
        observation: receipt?.observation || null, expected: receipt?.expected || null, resources: receipt?.resources || null };
      const repaired = repair?.independentlyObserved === true && repair?.useful === true;
      observed = { independent: receipt?.observation?.independentlyObserved === true,
        useful: repaired || receipt?.classification?.useful === true, result: repaired ? 'retest_matched' : receipt?.classification?.outcome || 'unknown',
        reason: result.reason, retest: repair || null, resources: receipt?.resources || null, predicateApplies: result.predicateApplies };
      artifact = result.artifact || prior?.artifact || null;
      if (receipt?.classification?.outcome === 'free_sufficient' && observed.independent) { qualification = 'free_already_sufficient'; reason = 'exact_free_output_matched'; }
      else if (repaired && observed.independent) { qualification = 'compatible_reusable_fix'; reason = 'caller_owned_live_retest_matched'; }
      else if (receipt?.missingField === true || receipt?.target402 === true || !observed.independent) { qualification = 'missing_task_input'; reason = receipt?.classification?.reason || result.reason || 'independent_observation_required'; }
      else if (request.implementation) { qualification = 'explicit_new_scoped_implementation_need'; reason = 'caller_requested_additional_scope'; }
      else { qualification = 'missing_task_input'; reason = 'changed_output_or_explicit_scope_required'; }
    }
    let quote = { status: 'withheld', reason: 'free_output_already_sufficient', authorized: false, paymentPerformed: false };
    if (qualification !== 'free_already_sufficient') {
      const url=request.kind==='seller'?auditUrl(request):null;
      const offer = request.quoteIntent && offerFor && request.kind === 'seller'
        ? await budget.wait(Promise.resolve(offerFor({ request, url, budget }))) : null;
      quote = quoteFor(request, binding, offer, now(),url);
    }
    const packet = { schema: PACKET, requestId: request.requestId, binding, qualification: { state: qualification, reason, paidDemandEstablished: false },
      claimant: { expectation: request.kind === 'surface' ? { concern: request.input.concern, result: 'no_match' } : request.input.expect,
        implementationRequest: request.implementation || null, ownership: 'caller_asserted_not_authority', usefulness: 'unknown' },
      baseline, observed, acceptance: { kind: request.kind, operationId: binding.operation.method + ' ' + binding.operation.origin + binding.operation.pathname,
        termsDigest: binding.termsDigest, criterion: request.kind === 'surface' ? { concernId: request.input.concern.id, result: 'no_match', staticOnly: true } : request.input.expect },
      regression, artifact, quote, workAcceptance: no('no_explicit_verified_acceptance'),
      reviewAdaptation: { durationMs: null, costAtomic: null, authority: 'unknown' },
      causal: no('no_authorized_observer_cut'), settlement: no('no_runtime_readback'),
      usefulOutcome: { operationPredicate: observed.useful, outsideUsefulness: 'unknown', laterUsefulness: 'unknown' },
      reuse: { localRerunPermitted: true, currentSharingAuthorized: regression?.authorized === true, paymentInherited: false, outcomeInherited: false },
      effort: { executionMs: Math.round((performance.now() - started) * 1000) / 1000, allowance: budget.snapshot(),
        marginalCashAtomic: '0', providerCalls: 0, modelTokens: 'unknown', apiEquivalentCost: 'unknown', includedQuotaOpportunityCost: 'unknown', sharedRndCost: 'unknown' },
      delivery: { replayAvailable: Boolean(store), proof: 'source_execution_without_customer_attribution', sourceAcceptedByRoot: false },
      publication: { productionHosted: false, hostedAcquisitionVerified: false, outsideUseful: false },
      paymentPerformed: false, skuAdded: false, priceChanged: false, recognizedRevenueAtomic: '0' };
    packet.acceptanceResult = evaluateAcceptance(packet);
    budget.check(); return sealPacket(packet);
  }
  return Object.freeze({
    async deliver(request, budget = allowance()) {
      validateRequest(request); budget.restrict(request.limits); ownerInput(request);
      const binding = validateRequest(request), requestDigest = digest(request);
      if (!store) return { packet: await fresh(request, binding, budget), replay: false, persistence: 'unconfigured' };
      const response = await budget.wait(packets.mutate(budget, async rows => {
        budget.check();
        const old = rows.filter(row => row.schema === RECORD && row.requestId === request.requestId && row.callerId === request.task.callerId);
        if (old.length > 1) fail('ambiguous_request');
        if (old.length) {
          if (old[0].requestDigest !== requestDigest) fail('request_binding_changed');
          return { result: { packet: verifyPacket(old[0].packet), replay: true, persistence: 'historical_readback' } };
        }
        const packet = await fresh(request, binding, budget);
        if (Buffer.byteLength(JSON.stringify(packet)) > budget.remainingOutput()) fail('output_bytes_exceeded');
        budget.check();
        return { append: { schema: RECORD, requestId: request.requestId, callerId: request.task.callerId, requestDigest, packet },
          result: { packet, replay: false, persistence: 'local_append_requires_readback' } };
      }));
      if (!response.replay) { await stored(response.packet.packetId, budget); response.persistence = 'local_readback'; }
      return response;
    },
    async accept(command, budget = allowance()) {
      const packet = await stored(command?.packetId, budget);
      const offer = offerFor && packet.quote?.status === 'candidate'
        ? await budget.wait(Promise.resolve(offerFor({ packet, url: packet.quote.offer.url, budget, review: true }))) : null;
      const acceptance = checkAcceptance(packet, command, { publicKey: publicKeys.get(packet.binding.task.callerId), currentOffer: offer, now: now() });
      return { packetId: packet.packetId, acceptance, paymentPerformed: false, recognizedRevenueAtomic: '0' };
    },
    async reuse(command, budget = allowance()) {
      const prior = await stored(command?.packetId, budget);
      const request = command?.request; validateRequest(request); budget.restrict(request.limits); ownerInput(request);
      const binding = validateRequest(request);
      const ownerMatches = binding.task.id === prior.binding.task.id && binding.task.callerId === prior.binding.task.callerId;
      const unchanged = ownerMatches && binding.digest === prior.binding.digest;
      if (!ownerMatches) return { inherited: false, reason: 'wrong_task_or_owner', current: null, paymentInherited: false };
      const current = await fresh(request, binding, budget, prior);
      return { inherited: false, applicability: unchanged ? 'same_scoped_input' : 'changed_input_requires_fresh_execution',
        reason: unchanged ? 'fresh_execution_and_current_authority' : 'changed_binding',
        priorSharingAuthorized: unchanged && current.regression?.authorized === true,
        current, paymentInherited: false, outcomeInherited: false, recognizedRevenueAtomic: '0' };
    },
    async review(command, budget = allowance()) {
      const packet = await stored(command?.packetId, budget);
      if (command.taskId !== packet.binding.task.id || command.callerId !== packet.binding.task.callerId) fail('wrong_task_or_owner');
      const observed = evaluateAcceptance(packet);
      const outcome = typeof command.claimantUseful === 'boolean' ? { value: command.claimantUseful, authority: 'claimant_statement',
        state: command.claimantUseful && !observed.passed ? 'contradicted_by_observed_work' : 'unverified_claim', outsideUseful: false } : no('claimant_outcome_absent');
      let projection = null;
      if (evidenceFor) {
        const cut = await budget.wait(Promise.resolve(evidenceFor({ packet, budget })));
        budget.read(Buffer.byteLength(JSON.stringify(cut))); projection = projectObserverEvidence(cut, { tick: () => budget.check() });
      }
      return { packetId: packet.packetId, observedWork: observed, claimantOutcome: outcome,
        reviewAdaptation: { durationMs: Number.isSafeInteger(command.reviewMs) && command.reviewMs >= 0 ? command.reviewMs : null,
          authority: 'claimant_statement', costAtomic: 'unknown' }, causalProjection: projection,
        settlement: projection ? 'inspect_existing_projection' : 'unknown', recognizedRevenueAtomic: '0' };
    },
  });
}
