import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { encodeAbiParameters, keccak256, parseAbiParameters, toBytes, toHex } from "viem";

export const FIXTURE_DIGEST = `sha256:${"ab".repeat(32)}`;

export function sha256Digest(text) {
  return `sha256:${createHash("sha256").update(String(text)).digest("hex")}`;
}

export function padAddressTopic(address) {
  return `0x${"0".repeat(24)}${String(address).slice(2).toLowerCase()}`;
}

export function hexQuantity(value) {
  return toHex(typeof value === "bigint" ? value : BigInt(value));
}

export function transferLog({ address, from, to, value }) {
  return {
    address,
    data: encodeAbiParameters(parseAbiParameters("uint256"), [BigInt(value)]),
    topics: [
      keccak256(toBytes("Transfer(address,address,uint256)")),
      padAddressTopic(from),
      padAddressTopic(to),
    ],
    removed: false,
  };
}

export function authorizationUsedLog({
  address, authorizer, nonce, transactionHash, blockNumber, blockHash, logIndex = 0, rpc = false,
}) {
  const log = {
    address,
    data: "0x",
    topics: [
      keccak256(toBytes("AuthorizationUsed(address,bytes32)")),
      padAddressTopic(authorizer),
      nonce.toLowerCase(),
    ],
    transactionHash,
    blockNumber: rpc ? hexQuantity(blockNumber) : blockNumber,
    blockHash,
    logIndex: rpc ? hexQuantity(logIndex) : logIndex,
    removed: false,
  };
  return log;
}

export function authorizationCanceledLog({
  address, authorizer, nonce, transactionHash, blockNumber, blockHash, logIndex = 1, rpc = false,
}) {
  return {
    address,
    data: "0x",
    topics: [
      keccak256(toBytes("AuthorizationCanceled(address,bytes32)")),
      padAddressTopic(authorizer),
      nonce.toLowerCase(),
    ],
    transactionHash,
    blockNumber: rpc ? hexQuantity(blockNumber) : blockNumber,
    blockHash,
    logIndex: rpc ? hexQuantity(logIndex) : logIndex,
    removed: false,
  };
}

export function blockResult({ number, hash, timestamp, parentHash = `0x${"11".repeat(32)}` }) {
  return {
    number: hexQuantity(number),
    hash,
    parentHash,
    timestamp: hexQuantity(timestamp),
    transactions: [],
  };
}

export function rpcOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Local JSON-RPC server for exercising the real viem-bounded reconcile transport.
 */
export async function withJsonRpcServer(handler, fn) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      let body = null;
      try {
        body = JSON.parse(raw.toString("utf8") || "null");
      } catch {
        body = raw.toString("utf8");
      }
      const result = await handler(req, body, raw);
      if (result && typeof result === "object" && (Buffer.isBuffer(result.body) || typeof result.body === "string")) {
        res.writeHead(result.status || 200, result.headers || { "content-type": "application/json" });
        res.end(result.body);
        return;
      }
      if (typeof result === "string" || Buffer.isBuffer(result)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(result);
        return;
      }
      if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "jsonrpc")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
        return;
      }
      const id = body && typeof body === "object" ? body.id ?? 1 : 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;
  try {
    return await fn(url, server);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
