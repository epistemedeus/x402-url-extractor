// Source observations are explicit fixture RPC boundaries; the production
// normalizer, HTTP and journal writes still execute. No chain/payment call.
export const feeHash='0x'+'a'.repeat(64);
export const absentHash='0x'+'b'.repeat(64);
export const failedHash='0x'+'c'.repeat(64);
export const claimHash='0x'+'d'.repeat(64);
export const changedHash='0x'+'e'.repeat(64);
export function fixtureClient(hash,{changed=false}={}) {
  const calls={receipt:0,block:0,paid:0,model:0};
  return {calls,
    async getTransactionReceipt({hash:requested}) {
      calls.receipt++;
      if(requested!==hash) throw new Error('equal_input_required');
      if(hash===failedHash) {const e=new Error('fixture provider unavailable');e.name='RpcUnavailable';throw e;}
      if(hash===absentHash) {const e=new Error('could not be found');e.name='TransactionReceiptNotFoundError';throw e;}
      return {status:'success',blockNumber:50n,logs:[],gasUsed:21000n,effectiveGasPrice:changed?3n:2n};
    },
    async getBlock() {calls.block++;return {timestamp:1790960400n};},
  };
}
