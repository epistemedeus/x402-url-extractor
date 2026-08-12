import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSolanaAgentRegistration,
  SOLANA_AGENT_REGISTRATION,
} from "./solana-agent-registration.mjs";

test("builds a stable pre-registration document without inventing an agent ID", () => {
  const registration = buildSolanaAgentRegistration({
    publicUrl: "https://agents.samedaydesk.com",
  });

  assert.equal(registration.type, "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  assert.equal(registration.active, true);
  assert.equal(registration.x402Support, true);
  assert.equal(registration.registrations, undefined);
  assert.deepEqual(
    registration.services.map(({ name }) => name),
    ["MCP", "A2A", "OpenAPI", "SKILL", "x402", "MPP", "ServiceDeployment", "ServiceDeploymentKey", "x402-solana", "MPP-solana", "agentWallet"],
  );
  assert.equal(registration.services[0].endpoint, "https://agents.samedaydesk.com/mcp");
  assert.equal(registration.services[2].endpoint, "https://agents.samedaydesk.com/openapi.json");
  assert.equal(registration.services[6].endpoint, "https://agents.samedaydesk.com/.well-known/agent-payment-policy-service-deployment.json");
  assert.equal(registration.services[7].endpoint, "https://agents.samedaydesk.com/.well-known/agent-payment-policy-service-deployment.pem");
  assert.equal(registration.services[8].endpoint, "https://solana.samedaydesk.com/.well-known/x402");
  assert.equal(
    registration.services[10].endpoint,
    `solana:${SOLANA_AGENT_REGISTRATION.chainId}:${SOLANA_AGENT_REGISTRATION.merchantWallet}`,
  );
});

test("binds the final asset to the exact mainnet registry", () => {
  const asset = "9xQeWvG816bUx9EPfEZrjB7XbVjMLHcnmvheqnzzUNNu";
  const registration = buildSolanaAgentRegistration({
    publicUrl: "https://agents.samedaydesk.com",
    agentAsset: asset,
  });

  assert.deepEqual(registration.registrations, [
    {
      agentId: asset,
      agentRegistry: `solana:${SOLANA_AGENT_REGISTRATION.chainId}:${SOLANA_AGENT_REGISTRATION.registry}`,
    },
  ]);
});

test("appends canonical paid actions without replacing protocol entry points", () => {
  const actions = [
    { name: "extract", route: "/extract" },
    { name: "defi_morpho_position", route: "/defi/morpho-position" },
  ];
  const registration = buildSolanaAgentRegistration({
    publicUrl: "https://agents.samedaydesk.com",
    actions,
  });
  const paid = registration.services.filter(({ name }) => name.startsWith("paid-action:"));
  assert.deepEqual(paid, [
    { name: "paid-action:extract", endpoint: "https://agents.samedaydesk.com/extract" },
    { name: "paid-action:defi_morpho_position", endpoint: "https://agents.samedaydesk.com/defi/morpho-position" },
  ]);
  assert.equal(registration.services[0].name, "MCP");
  assert.equal(registration.services.at(-1).name, "agentWallet");
});

test("rejects path-bearing origins and malformed asset IDs", () => {
  assert.throws(
    () => buildSolanaAgentRegistration({ publicUrl: "https://agents.example/path" }),
    /must not contain a path/,
  );
  assert.throws(
    () => buildSolanaAgentRegistration({ publicUrl: "https://agents.example", agentAsset: "not-a-key" }),
    /Solana public key/,
  );
  assert.throws(
    () => buildSolanaAgentRegistration({
      publicUrl: "https://agents.example",
      actions: [{ name: "extract", route: "/extract" }, { name: "other", route: "/extract" }],
    }),
    /routes must be unique/,
  );
});
