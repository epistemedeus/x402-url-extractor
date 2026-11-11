// Inert integration fixture only. No key input, wallet, broadcast or live paid request.
import {createHash} from 'node:crypto';
import {x402Client} from '@x402/core/client';
import {registerExactEvmScheme} from '@x402/evm/exact/client';
import {wrapFetchWithPayment} from '@x402/fetch';
export const PIN='edd757fe2d5185072a53e43fbfd861c9a5400158';
export const LIVE='https://nano-gpt.com/api/v1/chat/completions';
export const FIXTURE='https://fixture.example.test/api/v1/chat/completions';
export const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const INPUT='Return exactly the text base-transport-control.';
export const graph={v:1,nodes:[{id:'n1',type:'text',name:'Idea',fields:{text:''}},
  {id:'n2',type:'llm',fields:{model:'z-ai/glm-5.3-flash',reasoningEffort:'low',maxTokens:400}}],
  links:[{id:'l1',from:{node:'n1',port:'text'},to:{node:'n2',port:'prompt'}}]};
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code);};
const expiry=value=>typeof value==='number' ? (value<1e12?value*1000:value) : Date.parse(value);

export function createInertProbe({transport,endpoint=FIXTURE,input=INPUT,budgetAtomic='1000',binding,boundary='dummy',onSelected=()=>{}}){
  need([LIVE,FIXTURE].includes(endpoint),'endpoint_refused');
  need(typeof input==='string'&&input.trim(),'input_binding_required');
  need(/^[1-9][0-9]*$/.test(budgetAtomic),'atomic_budget_required');
  const stats={requests:0,paidFixtureRequests:0,signerBoundaryCalls:0,nanoCallbacks:0,selections:0};
  const authorizations=[];let originalBody,originalRequest,quoteDeadline;
  // This object has no private key or crypto implementation. Even its dummy
  // bytes can only be produced for the isolated fixture origin.
  const signer={address:'0x1111111111111111111111111111111111111111',async signTypedData(data){
    stats.signerBoundaryCalls++;
    need(endpoint===FIXTURE,'live_signature_forbidden');
    need(data.domain.chainId===8453&&data.domain.verifyingContract.toLowerCase()===USDC,'typed_domain_refused');
    need(data.message.value<=BigInt(budgetAtomic)&&Number(data.message.validBefore)*1000<=quoteDeadline,'typed_authority_bounds_refused');
    authorizations.push(data);
    if(boundary==='interrupt')throw Error('fixture_interrupted_authorization_boundary');
    return '0x'+'00'.repeat(65); // deliberately invalid, never a real signature
  }};
  const client=new x402Client();
  registerExactEvmScheme(client,{signer,networks:['eip155:8453']}); // also registers legacy v1 `base`
  client.setSpendControls({allowedAssets:[{network:'base',asset:USDC,maxAmountPerPayment:budgetAtomic}]});
  client.registerPolicy((version,requirements)=>requirements.filter(r=>version===1&&r.scheme==='exact'&&r.network==='base'&&r.asset?.toLowerCase()===USDC));
  client.onBeforePaymentCreation(async({paymentRequired:quote,selectedRequirements:selected})=>{
    stats.selections++;
    onSelected({quote,selected,request:originalRequest});
    need(originalRequest&&selected.resource===originalRequest.url,'quote_resource_binding_required');
    const hash=quote.requestHash??quote.payment?.requestHash;
    need(typeof hash==='string'&&hash.length>0,'quote_input_binding_required');
    quoteDeadline=expiry(selected.expiresAt??quote.payment?.expiresAt);
    need(Number.isFinite(quoteDeadline)&&quoteDeadline>Date.now(),'quote_expired_or_missing');
    need(Number.isSafeInteger(selected.maxTimeoutSeconds)&&selected.maxTimeoutSeconds>0&&
      (Math.floor(Date.now()/1000)+selected.maxTimeoutSeconds)*1000<=quoteDeadline,'authorization_exceeds_quote_expiry');
    // The live provider's requestHash canonicalization is not guessed here.
    // Tests supply an explicitly synthetic server binding. Live probe stops.
    need(typeof binding==='function'&&await binding({quote,selected,request:originalRequest}),'provider_body_binding_unqualified');
  });
  const fetch=wrapFetchWithPayment(async request=>{
    need(request.url===endpoint&&request.method==='POST','request_target_refused');
    need(request.headers.get('x-x402')==='true'&&!request.headers.has('authorization')&&!request.headers.has('x-api-key'),'keyless_request_required');
    const body=await request.clone().text(),j=JSON.parse(body);
    need(j.model==='z-ai/glm-5.3-flash'&&j.reasoning_effort==='low'&&j.max_tokens===400&&(j.stream??false)===false&&
      j.messages.some(row=>row.role==='user'&&row.content===input),'request_input_settings_changed');
    need(originalBody===undefined||body===originalBody,'request_body_changed');
    originalBody=body;originalRequest={url:request.url,method:request.method,body,bodySha256:digest(body)};
    const paid=request.headers.has('x-payment')||request.headers.has('payment-signature');
    need(!paid||endpoint===FIXTURE,'live_paid_request_forbidden');
    stats.requests++;if(paid)stats.paidFixtureRequests++;
    return transport(request);
  },client);
  return {fetch,client,stats,authorizations,workflowOptions:{apiKey:null,baseUrl:new URL(endpoint).origin,fetch,
    payment:async()=>{stats.nanoCallbacks++;throw Error('nano_fallback_forbidden');}}};
}
