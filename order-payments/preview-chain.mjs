import { erc20Abi, encodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { BASE_USDC } from "../settlement-proof.mjs";

const used = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Controlled preview only. Blocks and receipts are local to this test.
export function previewChain() {
  let blockNo = 3n;
  const receipts = [], blocks = new Map(), transactions = new Map();
  const publicClient = {
    getChainId: async () => 8453,
    getBlock: async ({ blockNumber }) => blocks.get(blockNumber) ?? { number: blockNo, timestamp: BigInt(Math.floor(Date.now()/1000)) },
    getTransaction: async ({hash}) => transactions.get(hash),
    getTransactionReceipt: async ({ hash }) => receipts.find(r => r.transactionHash === hash),
    async getLogs({ args, fromBlock, toBlock }) {
      return receipts.filter(r => r.blockNumber >= fromBlock && r.blockNumber <= toBlock && r.payer === args.authorizer && r.nonce === args.nonce)
        .map(r => r.logs[0]);
    },
  };
  function mine(auth,direct=false) {
    blockNo++;
    const hash = "0x" + blockNo.toString(16).padStart(64,"0");
    const block = { number: blockNo, timestamp: BigInt(Math.floor(Date.now()/1000)), hash };
    blocks.set(blockNo, block);
    const log = (topics,data,logIndex) => ({ address: BASE_USDC, topics, data, logIndex, blockHash: hash, blockNumber: blockNo, transactionHash: hash });
    const logs = [log(encodeEventTopics({ abi: [used], args: { authorizer: auth.from, nonce: auth.nonce } }), "0x", 0),
      log(encodeEventTopics({ abi: [transfer], args: { from: auth.from, to: auth.to } }), encodeAbiParameters([{ type: "uint256" }], [BigInt(auth.value)]), 1)];
    if(direct) {
      logs.shift(); logs[0].logIndex=0;
      transactions.set(hash,{ hash,from:auth.from,to:BASE_USDC,blockHash:hash,value:0n,
        input:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[auth.to,BigInt(auth.value)]}) });
    }
    receipts.push({ status: "success", from: "0x" + "5".repeat(40), transactionHash: hash, blockHash: hash, blockNumber: blockNo, payer: auth.from, nonce: auth.nonce, logs });
    return hash;
  }
  return { publicClient, mine };
}
