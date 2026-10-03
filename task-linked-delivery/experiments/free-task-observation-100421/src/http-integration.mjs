import { OPERATION, ROUTE } from './receipt.mjs';

const CURRENT_PATH='/.well-known/useful-result-reuse/current.json';
const GRANT_READ_PATH='/.well-known/useful-result-reuse/retained';
const header=(req,name)=>typeof req.headers?.[name]==='string'?req.headers[name]:'';

export function exposeAuthorizedCausalProof(req,res,{telemetry,internalToken,authorizeOutcomeBinding}) {
  if(req.path!==ROUTE||req.method!=='GET'||header(req,'x-samedaydesk-observe-free-result')!=='1') return false;
  const claim=authorizeOutcomeBinding(req.headers,internalToken);
  if(!claim?.taskRef||claim.operationId!==OPERATION) return false;
  const proof=telemetry.causalCommerceEventProof(res);
  if(!proof) return false;
  res.set('x-samedaydesk-causal-event',proof);res.set('x-samedaydesk-outcome-task-ref',claim.taskRef);
  return true;
}

// Opt-in adapter on the existing observation and grant resources. Root supplies
// its existing parsed-body/authentication handler; this owns no server/backend.
export function handleFreeTaskObservation(req,res,{bridge,service,handleUsefulResultReuse}) {
  if(req.path===CURRENT_PATH&&req.method==='POST') {
    const action=header(req,'x-samedaydesk-result-action');
    const input={...req.body,suppliedToken:header(req,'x-samedaydesk-internal')};
    const operation=action==='observe-free-result'?bridge.observe:action==='reconcile-free-result'?bridge.reconcile:null;
    if(!operation) {res.status(400).json({error:'action_rejected',paymentPermitted:false});return true;}
    void operation(input).then(result=>res.status(result.accepted||result.reason==='duplicate'?200:
      result.reason==='write_outcome_unknown'?503:403).json(result)).catch(e=>res.status(400).json({error:e.code||'rejected',paymentPermitted:false}));
    return true;
  }
  if(req.path===GRANT_READ_PATH) {
    const scoped={...service,readDeliveredReceipt:input=>bridge.readDeliveredReceipt({...input,
      taskRef:header(req,'x-samedaydesk-outcome-task-ref')||null,commerceEventId:header(req,'x-samedaydesk-causal-attempt')||null}),
      revokeDeliveredReceipt:bridge.revokeDeliveredReceipt,
      shareDeliveredKnowledge:async input=>await bridge.grantActionAllowed(input.token,'share-knowledge')
        ?service.shareDeliveredKnowledge(input):{accepted:false,reason:'action_rejected'},
      correctDeliveredKnowledge:async input=>await bridge.grantActionAllowed(input.token,'correct-knowledge')
        ?service.correctDeliveredKnowledge(input):{accepted:false,reason:'action_rejected'}};
    return handleUsefulResultReuse(req,res,scoped);
  }
  return false;
}
export function callerObservation({bodyBase64,proof,eventId,taskRef,taskLabel,predicate=null,callerClaim,cohort='owner_qa'}) {
  return {optIn:true,causalEventProof:proof,commerceEventId:eventId,taskLabel,taskRef,operationId:OPERATION,
    cohort,method:'GET',route:ROUTE,bodyBase64,predicate,...(callerClaim===undefined?{}:{callerClaim})};
}
