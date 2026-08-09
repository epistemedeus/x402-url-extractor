import { privateKeyToAccount } from "viem/accounts";
import {
  createEIP712OfferReceiptIssuer,
  createOfferReceiptExtension,
  declareOfferReceiptExtension,
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
    resourceServerExtension: createOfferReceiptExtension(issuer),
    routeExtensions: declareOfferReceiptExtension({ includeTxHash }),
  };
}
