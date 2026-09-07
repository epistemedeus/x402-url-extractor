import { privateKeyToAccount } from "viem/accounts";

/**
 * Customer-owned wallet injection. This example never stores Pilot private
 * buyer tools or default wallet paths. Callers pass an account or a key only
 * for explicit --approve execution.
 */
export function resolveBuyerAccount({ account = null, privateKey = null } = {}) {
  if (account) return account;
  if (!privateKey) {
    const error = new Error("explicit purchase requires an injected buyer account or private key");
    error.code = "wallet_required";
    throw error;
  }
  const key = String(privateKey);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    const error = new Error("buyer private key must be a 0x-prefixed 32-byte hex string");
    error.code = "wallet_invalid";
    throw error;
  }
  return privateKeyToAccount(/** @type {`0x${string}`} */ (key));
}
