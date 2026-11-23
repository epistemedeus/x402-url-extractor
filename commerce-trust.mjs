import { privateKeyToAccount } from "viem/accounts";
import {
  createEIP712OfferReceiptIssuer,
  createOfferReceiptExtension,
  declareOfferReceiptExtension,
  signReceiptEIP712,
} from "@x402/extensions/offer-receipt";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function createCommerceTrust({ privateKey, network, includeTxHash = true } = {}) {
  if (!privateKey) {
    return {
      enabled: false,
      signerAddress: null,
      keyId: null,
      resourceServerExtension: null,
      routeExtensions: {},
    };
  }
  if (!PRIVATE_KEY_PATTERN.test(String(privateKey))) {
    throw new Error("RECEIPT_SIGNING_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  }
  if (!/^eip155:\d+$/.test(String(network || ""))) {
    throw new Error("receipt signing requires an eip155 CAIP-2 network");
  }
  const account = privateKeyToAccount(privateKey);
  const keyId = `did:pkh:${network}:${account.address}`;
  const issuer = createEIP712OfferReceiptIssuer(
    keyId,
    (typedData) => account.signTypedData(typedData),
  );
  return {
    enabled: true,
    signerAddress: account.address,
    keyId,
    issuer,
    // The same finalized order always has the same merchant receipt, including
    // a later read after a lost response. The issuer stays inside this owner.
    async finalizedOrderReceipt(resourceUrl, payer, transaction, issuedAt) {
      const payload = { version: 1, resourceUrl, payer, network, transaction, issuedAt };
      return { format: "eip712", payload, signature: await signReceiptEIP712(payload, typed => account.signTypedData(typed)) };
    },
    resourceServerExtension: createOfferReceiptExtension(issuer),
    routeExtensions: declareOfferReceiptExtension({ includeTxHash }),
  };
}
