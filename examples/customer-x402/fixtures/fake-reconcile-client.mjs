/**
 * Permissive fake public-client stand-in for unit tests only.
 * Production reconcile uses official viem + bounded HTTP JSON-RPC transport.
 */
export function createFakeReconcileClient(handlers = {}) {
  return {
    async getChainId() {
      if (handlers.getChainId) return handlers.getChainId();
      return 8453;
    },
    async readContract(args) {
      if (handlers.readContract) return handlers.readContract(args);
      throw new Error("fake readContract not configured");
    },
    async getBlockNumber() {
      if (handlers.getBlockNumber) return handlers.getBlockNumber();
      return 1000n;
    },
    async getBlock(args) {
      if (handlers.getBlock) return handlers.getBlock(args);
      const number = args?.blockNumber ?? (await this.getBlockNumber());
      return {
        number,
        hash: `0x${"ab".repeat(32)}`,
        timestamp: 1_700_000_000n,
      };
    },
    async getLogs(args) {
      if (handlers.getLogs) return handlers.getLogs(args);
      return [];
    },
    async getTransactionReceipt(args) {
      if (handlers.getTransactionReceipt) return handlers.getTransactionReceipt(args);
      return null;
    },
  };
}
