import assert from "node:assert/strict";
import test from "node:test";

import { verifyOfferSignatureEIP712, verifyReceiptSignatureEIP712 } from "@x402/extensions/offer-receipt";
import { createCommerceTrust } from "./commerce-trust.mjs";

const PRIVATE_KEY = `0x${"1".repeat(64)}`;

test("disables signed commerce artifacts when no receipt key is configured", () => {
  const trust = createCommerceTrust({ network: "eip155:8453" });
  assert.equal(trust.enabled, false);
  assert.deepEqual(trust.routeExtensions, {});
});

test("fails closed on malformed receipt keys and networks", () => {
  assert.throws(() => createCommerceTrust({ privateKey: "0x1234", network: "eip155:8453" }), /32-byte/);
  assert.throws(() => createCommerceTrust({ privateKey: PRIVATE_KEY, network: "base" }), /CAIP-2/);
});

test("signs independently verifiable EIP-712 offers and receipts", async () => {
  const trust = createCommerceTrust({ privateKey: PRIVATE_KEY, network: "eip155:8453" });
  const offer = await trust.issuer.issueOffer("https://service.example/data?q=1", {
    acceptIndex: 0,
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    amount: "1000",
    offerValiditySeconds: 300,
  });
  const verifiedOffer = await verifyOfferSignatureEIP712(offer);
  assert.equal(verifiedOffer.signer.toLowerCase(), trust.signerAddress.toLowerCase());
  assert.equal(verifiedOffer.payload.resourceUrl, "https://service.example/data?q=1");

  const receipt = await trust.issuer.issueReceipt(
    "https://service.example/data?q=1",
    "0x1111111111111111111111111111111111111111",
    "eip155:8453",
    `0x${"2".repeat(64)}`,
  );
  const verifiedReceipt = await verifyReceiptSignatureEIP712(receipt);
  assert.equal(verifiedReceipt.signer.toLowerCase(), trust.signerAddress.toLowerCase());
  assert.equal(verifiedReceipt.payload.payer, "0x1111111111111111111111111111111111111111");
});
