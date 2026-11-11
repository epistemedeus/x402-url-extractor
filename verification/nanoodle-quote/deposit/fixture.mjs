// Tiny one-shot integration fixture. No wallet/key/signer or production effects.
// Only the fixed synthetic origin can acknowledge a deposit, poll or complete.
import {INPUT,FIXTURE,USDC,digest} from '../base/probe.mjs';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const atomic=x=>typeof x==='string'&&/^[1-9][0-9]{0,29}$/.test(x);
const toMs=x=>typeof x==='number'&&Number.isSafeInteger(x)?(x<1e12?x*1000:x):typeof x==='string'?Date.parse(x):NaN;
const json=async(response,code)=>{try{return await response.json();}catch{throw Error(code);}};
function route(value,kind,id,origin){
  let u;try{u=new URL(value);}catch{throw Error('deposit_operation_url_refused');}
  need(u.origin===origin&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname===`/api/x402/${kind}/${id}`,'deposit_operation_url_refused');
  return u.href;
}
/** Primary payment envelope only. Legacy hashes and generic primary-rail URLs
 * are not substitutes for this Base option's own identity or routes. */
export function qualifyDepositQuote(q,{request,budgetAtomic,now=Date.now()}){
  need(atomic(budgetAtomic),'deposit_budget_required');
  need(request?.method==='POST'&&typeof request.body==='string'&&request.bodySha256===digest(request.body),'deposit_request_binding_required');
  const origin=new URL(request.url).origin;
  const p=q?.payment,options=p?.accepted?.filter(a=>a?.scheme==='base-usdc');
  need(Array.isArray(options)&&options.length===1,'deposit_rail_missing_or_ambiguous');
  const o=options[0];
  need(o.network==='base'&&(!o.protocolScheme||['usdc-base','base-usdc'].includes(o.protocolScheme)),'deposit_network_or_rail_refused');
  need(atomic(o.amount)&&BigInt(o.amount)<=BigInt(budgetAtomic),'deposit_atomic_amount_refused');
  const formatted=typeof o.amountFormatted==='string'&&/^(0|[1-9][0-9]*)\.([0-9]{1,6}) USDC$/.exec(o.amountFormatted);
  need(formatted&&BigInt(formatted[1])*1000000n+BigInt(formatted[2].padEnd(6,'0'))===BigInt(o.amount),'deposit_units_refused');
  need(/^0x[0-9a-fA-F]{40}$/.test(o.payTo??'')&&!/^0x0{40}$/i.test(o.payTo),'deposit_destination_refused');
  // No identity is inferred from the label or formatted estimate. An actual
  // contract must match the independently configured native-USDC test identity.
  const assets=[o.asset,o.extra?.tokenAddress].filter(x=>x!==undefined);
  need(assets.length>0,'deposit_asset_identity_unreceived');
  need(assets.every(x=>typeof x==='string'&&x.toLowerCase()===USDC),'deposit_asset_refused');
  need(o.extra?.chainId===undefined||o.extra.chainId===8453,'deposit_chain_refused');
  need(o.extra?.tokenDecimals===undefined||o.extra.tokenDecimals===6,'deposit_decimals_refused');
  need(typeof o.paymentId==='string'&&/^pay_[A-Za-z0-9_-]{1,100}$/.test(o.paymentId),'deposit_operation_id_refused');
  const statusUrl=route(o.statusUrl,'status',o.paymentId,origin),completeUrl=route(o.completeUrl,'complete',o.paymentId,origin);
  const expiresAt=toMs(o.expiresAt);
  need(Number.isFinite(expiresAt)&&expiresAt>now,'deposit_expired_or_missing');
  need(typeof p.requestHash==='string'&&/^(sha256:)?[a-fA-F0-9]{64}$/.test(p.requestHash),'deposit_request_binding_required');
  need(o.requestHash===undefined||o.requestHash===p.requestHash,'deposit_request_binding_conflict');
  return Object.freeze({scheme:'base-usdc',network:'base',asset:USDC,amountAtomic:o.amount,payTo:o.payTo,paymentId:o.paymentId,
    statusUrl,completeUrl,expiresAt,requestHash:p.requestHash,request:Object.freeze({...request})});
}
/** In-memory one-shot guard, not restart recovery or a payment authority. Never
 * reconstruct this fixture to resume an unknown outcome. No live effect port. */
export function createDepositFixture({transport,acknowledgeDeposit,budgetAtomic='1000',wait=ms=>new Promise(r=>setTimeout(r,ms))}){
  need(typeof transport==='function'&&typeof acknowledgeDeposit==='function','fixture_callbacks_required');
  let entered=false;
  const stats={quoteRequests:0,depositCallbacks:0,statusRequests:0,completionRequests:0,nanoCallbacks:0};
  const call=async request=>{
    need(new URL(request.url).origin===new URL(FIXTURE).origin,'fixture_effect_only');
    try{return await transport(request,{redirect:'error',signal:request.signal});}catch{throw Error('deposit_transport_outcome_unknown');}
  };
  const fetch=async(url,init)=>{
    need(!entered,'one_shot_already_entered');entered=true;
    try{
      const r=new Request(url,init);
      need(r.url===FIXTURE&&r.method==='POST','deposit_request_target_refused');
      need(r.headers.get('x-x402')==='true'&&!['authorization','x-api-key','x-payment','payment-signature','x-x402-payment-id'].some(h=>r.headers.has(h)),'deposit_keyless_request_required');
      const body=await r.clone().text(),j=JSON.parse(body);
      need(j.model==='z-ai/glm-5.3-flash'&&j.reasoning_effort==='low'&&j.max_tokens===400&&(j.stream??false)===false&&
        j.messages?.some(m=>m.role==='user'&&m.content===INPUT),'deposit_request_settings_refused');
      const request=Object.freeze({url:r.url,method:r.method,body,bodySha256:digest(body)});
      stats.quoteRequests++;const quoted=await call(r);need(quoted.status===402,'deposit_quote_status_refused');
      const invoice=qualifyDepositQuote(await json(quoted,'deposit_quote_malformed'),{request,budgetAtomic});
      need(!r.signal.aborted&&Date.now()<invoice.expiresAt,'deposit_expired_or_aborted');
      stats.depositCallbacks++;
      let ack;try{ack=await acknowledgeDeposit(invoice);}catch{throw Error('deposit_acknowledgement_unknown');}
      need(ack?.acknowledged===true&&ack.paymentId===invoice.paymentId&&ack.amountAtomic===invoice.amountAtomic&&
        ack.payTo===invoice.payTo&&ack.bodySha256===request.bodySha256,'deposit_acknowledgement_unknown');
      for(let n=0;n<3;n++){
        need(!r.signal.aborted&&Date.now()<invoice.expiresAt,'deposit_expired_or_aborted');
        stats.statusRequests++;
        const response=await call(new Request(invoice.statusUrl,{signal:r.signal}));
        need(response.status===200,'deposit_status_unknown');
        const s=await json(response,'deposit_status_unknown');
        need(s?.paymentId===invoice.paymentId,'deposit_status_operation_refused');
        if(s.status==='paid'){
          need(s.readyToComplete!==false,'deposit_status_not_ready');
          need(!r.signal.aborted&&Date.now()<invoice.expiresAt,'deposit_expired_or_aborted');
          stats.completionRequests++;
          const cr=await call(new Request(invoice.completeUrl,{method:'POST',headers:{'content-type':'application/json','x-x402':'true'},body:'{}',signal:r.signal}));
          need(cr.status===200&&cr.headers.get('content-type')?.split(';')[0].trim()==='application/json','deposit_completion_unknown');
          const result=await json(cr,'deposit_completion_unknown');
          need(Array.isArray(result.choices)&&result.choices.length===1&&result.choices[0]?.message?.role==='assistant'&&
            typeof result.choices[0]?.message?.content==='string','deposit_completion_malformed');
          return new Response(JSON.stringify(result),{status:200,headers:cr.headers});
        }
        need(s.status==='pending','deposit_status_not_ready');
        need(n<2&&Number.isSafeInteger(s.pollAfterSeconds)&&s.pollAfterSeconds>=1&&s.pollAfterSeconds<=5,'deposit_poll_bound_reached');
        need(Date.now()+s.pollAfterSeconds*1000<invoice.expiresAt,'deposit_expired_or_aborted');
        await wait(s.pollAfterSeconds*1000);
      }
    }catch(e){
      // Only fixture codes reach RunError. Never echo provider data or IDs.
      throw Error(/^(deposit_|fixture_|one_shot_)[a-z_]+$/.test(e.message)?e.message:'deposit_outcome_unknown');
    }
  };
  return {stats,workflowOptions:{apiKey:null,baseUrl:new URL(FIXTURE).origin,fetch,payment:async()=>{stats.nanoCallbacks++;throw Error('nano_fallback_forbidden');}}};
}
