import { transactionReceipt } from '../../../../transaction-receipt.mjs';
import { changedHash,fixtureClient } from './receipt-fixtures.mjs';
// Node process, not a model/agent. Provider input is explicit, environment empty.
process.once('message',async input=>{
  try {
    const client=fixtureClient(input.transactionHash,{changed:input.transactionHash===changedHash});
    const body=await transactionReceipt(input,{client});
    process.send({body,provenance:'fixture_rpc',providerCalls:client.calls,pid:process.pid},()=>process.disconnect());
  } catch(e) {process.send({error:e.code||'replay_failed'},()=>process.disconnect());}
});
