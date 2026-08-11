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
    ["MCP", "A2A", "x402", "MPP", "agentWallet"],
  );
  assert.equal(registration.services[0].endpoint, "https://agents.samedaydesk.com/mcp");
  assert.equal(registration.services[2].endpoint, "https://solana.samedaydesk.com/.well-known/x402");
  assert.equal(
    registration.services[4].endpoint,
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

test("rejects path-bearing origins and malformed asset IDs", () => {
  assert.throws(
    () => buildSolanaAgentRegistration({ publicUrl: "https://agents.example/path" }),
    /must not contain a path/,
  );
  assert.throws(
    () => buildSolanaAgentRegistration({ publicUrl: "https://agents.example", agentAsset: "not-a-key" }),
    /Solana public key/,
  );
});
