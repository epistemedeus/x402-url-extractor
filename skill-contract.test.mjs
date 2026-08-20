import assert from "node:assert/strict";
import test from "node:test";
import { buildSkillContract } from "./skill-contract.mjs";

const extractExample = "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com";
const preflightExample = "https://agents.samedaydesk.com/commerce/payment-offer-preflight?url=https%3A%2F%2Fexample.com";
const gatewayExample = "https://agents.samedaydesk.com/gateway/commerce/payment-offer-preflight?url=https%3A%2F%2Fexample.com";
const postBody = {
  profileId: "privy-solana-lab",
  provider: "Privy",
  network: "solana:mainnet",
  protocol: "x402",
  observations: [{ case: "intended", actual: "allowed", denialClass: "none", code: "signed" }],
};

function getRequest(url, queryParams, required) {
  const parsed = new URL(url);
  const exampleUrl = new URL(url);
  for (const [name, value] of Object.entries(queryParams).sort(([left], [right]) => left.localeCompare(right))) {
    exampleUrl.searchParams.set(name, String(value));
  }
  return {
    method: "GET",
    url: parsed.origin + parsed.pathname,
    example: { type: "http", method: "GET", queryParams },
    schema: { properties: { queryParams: { required } } },
    exampleUrl: exampleUrl.href,
  };
}

test("compact skill contract advertises the payment-offer preflight boundary", () => {
  const contract = buildSkillContract("https://agents.samedaydesk.com/ignored/path", [
    {
      method: "GET",
      route: "/extract",
      priceUsdc: 0.05,
      paymentProtocols: ["x402", "mpp"],
      request: getRequest(extractExample, { url: "https://example.com" }, ["url"]),
    },
    {
      method: "GET",
      route: "/commerce/payment-offer-preflight",
      priceUsdc: 0.005,
      paymentProtocols: ["x402", "mpp"],
      request: getRequest(preflightExample, { url: "https://example.com" }, ["url"]),
    },
    {
      method: "POST",
      route: "/security/wallet-policy-conformance",
      priceUsdc: 0.01,
      paymentProtocols: ["x402", "mpp"],
      request: {
        method: "POST",
        url: "https://agents.samedaydesk.com/security/wallet-policy-conformance",
        example: { type: "http", method: "POST", bodyType: "json", body: postBody },
        schema: { properties: { body: { required: ["profileId", "provider", "network", "protocol", "observations"] } } },
      },
    },
  ], {
    route: "/gateway/commerce/payment-offer-preflight",
    priceUsdc: 0.005,
    request: getRequest(gatewayExample, { url: "https://example.com" }, ["url"]),
  });

  assert.match(contract, /x402 and MPP offer preflight/);
  assert.match(contract, /Payment-offer preflight compares one exact public HTTPS GET target/);
  assert.match(contract, /uses no credential/);
  assert.match(contract, /signs and sends no target payment/);
  assert.match(contract, /A parseable offer is not permission to pay/);
  assert.match(contract, /https:\/\/agents\.samedaydesk\.com\/api\/actions/);
  assert.match(contract, /https:\/\/agents\.samedaydesk\.com\/\.well-known\/agent-payment-evidence\.json/);
  assert.match(contract, /seller-declared evidence, not permission to spend/);
  assert.match(contract, /GET \/extract: 0\.05 USDC through x402 \+ mpp\. Example: https:\/\/agents\.samedaydesk\.com\/extract\?url=https%3A%2F%2Fexample\.com/);
  assert.match(contract, /GET \/commerce\/payment-offer-preflight: 0\.005 USDC through x402 \+ mpp\. Example: https:\/\/agents\.samedaydesk\.com\/commerce\/payment-offer-preflight\?url=https%3A%2F%2Fexample\.com/);
  assert.match(contract, /JSON body example \(do not transmit\): /);
  assert.match(contract, /X-SameDayDesk-Agent-Source: agent-skills-v1/);
  assert.match(contract, /not a second catalog action/);
  assert.match(contract, /Example: https:\/\/agents\.samedaydesk\.com\/gateway\/commerce\/payment-offer-preflight\?url=https%3A%2F%2Fexample\.com/);
  assert.doesNotMatch(contract, /ignored\/path/);
  assert.doesNotMatch(contract, /https:\/\/agents\.samedaydesk\.com\/security\/wallet-policy-conformance\?/);
});

test("compact skill contract rejects an invalid public origin", () => {
  assert.throws(() => buildSkillContract("not a URL", [{}]), TypeError);
});

test("compact skill contract fails closed on missing, malformed, or duplicate actions", () => {
  assert.throws(() => buildSkillContract("https://example.com", []), /non-empty array/);
  assert.throws(
    () => buildSkillContract("https://example.com", [{ method: "GET", route: "extract", priceUsdc: 0.05, paymentProtocols: ["x402"] }]),
    /invalid action contract/,
  );
  const action = {
    method: "GET",
    route: "/extract",
    priceUsdc: 0.05,
    paymentProtocols: ["x402", "mpp"],
    request: getRequest("https://example.com/extract?url=https%3A%2F%2Fexample.com", { url: "https://example.com" }, ["url"]),
  };
  assert.throws(() => buildSkillContract("https://example.com", [action, action]), /duplicate action contract/);
});
