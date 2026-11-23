import { Challenge, PaymentRequest } from "mppx";
import { authorizationDomain, authorizationTypes, AuthorizationPayloadSchema, challengeHash } from "mppx/evm";
import { evm, Mppx } from "mppx/server";
import { formatUnits, getAddress, recoverTypedDataAddress } from "viem";

export function orderCharge(quote, amount, merchant, secretKey, facilitator) {
  const methods=evm({currency:evm.assets.base.USDC,recipient:merchant,x402:{facilitator}});
  const server=Mppx.create({secretKey,realm:new URL(quote.resource).host,methods});
  const route=server.evm.charge({amount:formatUnits(BigInt(amount),6),externalId:quote.id,
    scope:JSON.stringify([quote.resource,quote.version,quote.created,quote.expires,amount]),
    expires:new Date(quote.expires).toISOString()});
  return {method:methods[0],route};
}

// A signer can bring back the original wire after its spending permission has
// expired. Reconstruct its exact challenge; the only provider operations allowed
// by this receiving path are the separate finalized chain reads.
export async function historicalAuthorization(request, quote, amount, merchant, secretKey, key) {
  const unused=()=>{throw Error("historical receiving cannot submit");};
  const {method,route}=orderCharge(quote,amount,merchant,secretKey,{verify:unused,settle:unused});
  const offered=await route(new Request(quote.resource));
  const wireChallenge=Challenge.fromResponse(offered.challenge);
  const expected=wireChallenge.opaque ? {...wireChallenge,meta:PaymentRequest.deserialize(wireChallenge.opaque)} : wireChallenge;
  const credential=method.transport.getCredential(request);
  if(!credential) return null;
  const bound=await method.transport.bindCredential({input:request,credential,challenge:expected});
  if(bound.challenge.id!==expected.id || bound.challenge.realm!==expected.realm || !Challenge.verify(bound.challenge,{secretKey})) return null;
  const payload=AuthorizationPayloadSchema.parse(bound.payload);
  const protocol=request.headers.has("payment-signature") ? "x402" : "mpp";
  // The maintained x402 binder verifies its resource nonce. Payment-auth uses
  // the maintained challenge hash over the issuer-bound original challenge.
  if(protocol==="mpp" && payload.nonce!==challengeHash(expected)) return null;
  const from=getAddress(payload.from),to=getAddress(payload.to);
  if(to!==getAddress(merchant) || BigInt(payload.value)<=0n || BigInt(payload.validBefore)<=BigInt(payload.validAfter)) return null;
  const {address,transfer}=evm.assets.base.USDC;
  const recovered=await recoverTypedDataAddress({domain:authorizationDomain({authorization:transfer,chainId:8453,currency:address}),
    types:authorizationTypes,primaryType:"TransferWithAuthorization",signature:payload.signature,message:{
      from,to,nonce:payload.nonce,value:BigInt(payload.value),validAfter:BigInt(payload.validAfter),validBefore:BigInt(payload.validBefore)}});
  if(recovered!==from) return null;
  return {requestKey:key,payer:from,nonce:payload.nonce,validBefore:payload.validBefore,version:quote.version,protocol,nextBlock:quote.startBlock};
}
