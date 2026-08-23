import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { verifyServiceDeploymentStatement } from "agent-payment-policy";
import { loadServiceDeploymentPublication, readServiceDeploymentCanonicalOrigin } from "./service-deployment-publication.mjs";
import { SERVICE_DEPLOYMENT_ROUTES } from "./service-deployment-routes.mjs";
import { SOLANA_AGENT_REGISTRATION } from "./solana-agent-registration.mjs";

const ORIGIN = "https://agents.samedaydesk.com";
const NETWORK = "eip155:8453";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const STATIC_ENVELOPE = JSON.parse(readFileSync(new URL("./service-deployment-statement.json", import.meta.url), "utf8"));
const STATIC_PAYLOAD = JSON.parse(Buffer.from(STATIC_ENVELOPE.payload, "base64url").toString("utf8"));
const NOW = Date.parse(STATIC_PAYLOAD.issuedAt) + 1_000;

function publication(overrides = {}) {
  return loadServiceDeploymentPublication({
    canonicalOrigin: ORIGIN,
    network: NETWORK,
    asset: ASSET,
    recipient: RECIPIENT,
    operationalWallet: SOLANA_AGENT_REGISTRATION.merchantWallet,
    now: NOW,
    ...overrides,
  });
}

test("exposes the signed statement origin without requiring env", () => {
  assert.equal(readServiceDeploymentCanonicalOrigin(), ORIGIN);
  assert.equal(readServiceDeploymentCanonicalOrigin(STATIC_ENVELOPE), ORIGIN);
});

test("binds every production route to both exact Base settlement protocols", () => {
  const value = publication();
  assert.equal(value.active, true);
  assert.equal(value.routeCount, SERVICE_DEPLOYMENT_ROUTES.length);
  assert.equal(value.routeCount, 24);
  assert.equal(value.settlementCount, 2);
  assert.equal(value.operationalWallet, SOLANA_AGENT_REGISTRATION.merchantWallet);
  assert.match(value.publicKeyFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(value.envelope.metadata, undefined);
  for (const route of SERVICE_DEPLOYMENT_ROUTES) {
    for (const protocol of ["x402", "mpp"]) {
      const report = verifyServiceDeploymentStatement(value.envelope, {
        publicKey: value.publicKeyPem,
        request: { method: route.method, url: `${ORIGIN}${route.path}?private=value` },
        runtimeOffer: { protocol, network: NETWORK, asset: ASSET, recipient: RECIPIENT, decimals: 6 },
        now: NOW,
      });
      assert.equal(report.decision, "verified_exact_binding");
      assert.equal(report.boundary.paymentAuthorized, false);
      assert.doesNotMatch(JSON.stringify(report), /private|value/);
    }
  }
});

test("the PEM raw Ed25519 key is the registered operational wallet", () => {
  const value = publication();
  const key = createPublicKey(value.publicKeyPem);
  assert.equal(key.asymmetricKeyType, "ed25519");
  assert.equal(value.operationalWallet, "DSG8V4tkhPQH9tWibYKzWePHYEgfocJXMWBfDxGDtaED");
});

test("fails closed on production origin, route, settlement, or registered-wallet drift", () => {
  assert.throws(() => publication({ canonicalOrigin: "https://other.example" }), /origin does not match/);
  assert.throws(() => publication({ recipient: "0x1111111111111111111111111111111111111111" }), /settlement does not match/);
  assert.throws(() => publication({ operationalWallet: "11111111111111111111111111111111" }), /not the registered operational wallet/);
  const altered = structuredClone(publication().envelope);
  const payload = JSON.parse(Buffer.from(altered.payload, "base64url").toString("utf8"));
  payload.deployments[0].routes.pop();
  altered.payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.throws(() => publication({ envelope: altered }), /routes do not match|signature/);
});

test("keeps expired static evidence visible but inactive for rotation monitoring", () => {
  const value = publication({ now: Date.parse(STATIC_PAYLOAD.expiresAt) + 1_000 });
  assert.equal(value.active, false);
  assert.equal(value.expiresInMs < 0, true);
});
