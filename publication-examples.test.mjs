import assert from "node:assert/strict";
import test from "node:test";

import { buildSkillContract } from "./skill-contract.mjs";
import { renderGitHubMachineCommerceSkill } from "./github-machine-commerce-skill.mjs";
import { renderLlmsTxt } from "./machine-surface-parity.mjs";
import {
  callableGetExample,
  postSchemaBodyExample,
  validatePublicationExampleParity,
} from "./publication-examples.mjs";

const origin = "https://agents.example";
const postBody = {
  profileId: "privy-solana-lab",
  provider: "Privy",
  network: "solana:mainnet",
  protocol: "x402",
  observations: [{ case: "intended", actual: "allowed", denialClass: "none", code: "signed" }],
};

function getAction({
  route = "/extract",
  queryParams = { url: "https://example.com" },
  required = ["url"],
  exampleUrl,
} = {}) {
  const url = `${origin}${route}`;
  const computed = new URL(url);
  for (const [name, value] of Object.entries(queryParams).sort(([left], [right]) => left.localeCompare(right))) {
    computed.searchParams.set(name, String(value));
  }
  return {
    method: "GET",
    route,
    url,
    priceUsdc: 0.005,
    priceAtomicUsdc: "5000",
    paymentProtocols: ["x402", "mpp"],
    description: "Extract a public page.",
    request: {
      method: "GET",
      url,
      example: { type: "http", method: "GET", queryParams },
      schema: { properties: { queryParams: { required } } },
      exampleUrl: exampleUrl || computed.href,
    },
  };
}

function postAction() {
  return {
    method: "POST",
    route: "/security/wallet-policy-conformance",
    url: `${origin}/security/wallet-policy-conformance`,
    priceUsdc: 0.01,
    priceAtomicUsdc: "10000",
    paymentProtocols: ["x402", "mpp"],
    description: "Evaluate standardized wallet-policy observations.",
    request: {
      method: "POST",
      url: `${origin}/security/wallet-policy-conformance`,
      example: { type: "http", method: "POST", bodyType: "json", body: postBody },
      schema: { properties: { body: { required: ["profileId", "provider", "network", "protocol", "observations"] } } },
    },
  };
}

function documents(actions, alternate) {
  const llms = renderLlmsTxt({
    origin,
    facilitator: "cdp",
    payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    actions,
    alternate,
    buyerPolicyRelease: "https://example.com/policy",
    purchaseEvidencePath: "/.well-known/agent-payment-evidence.json",
  });
  return {
    llms,
    skillMd: buildSkillContract(origin, actions, alternate),
    githubSkill: renderGitHubMachineCommerceSkill({ origin, actions, alternate }),
  };
}

test("publishes a public Solana transaction signature as a required query example", () => {
  const action = getAction({
    route: "/chain/solana-transaction-receipt",
    queryParams: { signature: "3CjY38avdggKZbKfu2BmFYN4MUTiiNX27c8dHzPW79PrAx3huB9Pa6AfwW6sT4biax3y22z8toyLzmjtCc2QGNZn" },
    required: ["signature"],
  });
  const example = callableGetExample(action);
  assert.equal(example.requiredKeys.includes("signature"), true);
  assert.match(example.exampleUrl, /[?&]signature=/);
});

test("GET publication examples require every non-secret query key on a credential-free HTTPS URL", () => {
  const action = getAction({
    route: "/work/opportunity-preflight",
    queryParams: { hours: 0.25, hourlyCostUsd: 4, rewardUsd: 10 },
    required: ["rewardUsd", "hours", "hourlyCostUsd"],
  });
  const example = callableGetExample(action);
  assert.equal(example.transmissible, true);
  assert.deepEqual(example.requiredKeys, ["rewardUsd", "hours", "hourlyCostUsd"]);
  assert.equal(
    example.exampleUrl,
    "https://agents.example/work/opportunity-preflight?hourlyCostUsd=4&hours=0.25&rewardUsd=10",
  );
  const parsed = new URL(example.exampleUrl);
  for (const key of example.requiredKeys) assert.ok(parsed.searchParams.get(key));
});

test("POST publication examples stay schema/body documents and are not transmissible", () => {
  const example = postSchemaBodyExample(postAction());
  assert.equal(example.transmissible, false);
  assert.equal(example.bodyJson, JSON.stringify(postBody));
  assert.equal(example.exampleUrl, undefined);
});

test("cross-surface llms, origin skill, and GitHub skill share the same GET examples", () => {
  const actions = [getAction(), postAction()];
  const alternate = {
    route: "/gateway/commerce/payment-offer-preflight",
    priceUsdc: 0.005,
    priceAtomicUsdc: "5000",
    request: getAction({
      route: "/gateway/commerce/payment-offer-preflight",
      queryParams: { url: "https://example.com" },
      required: ["url"],
    }).request,
  };
  const docs = documents(actions, alternate);
  assert.deepEqual(validatePublicationExampleParity({ actions, alternate, documents: docs }), {
    ok: true,
    getExamples: 1,
    postExamples: 1,
    alternateExamples: 1,
    documentCount: 3,
  });
  const extractUrl = actions[0].request.exampleUrl;
  const gatewayUrl = alternate.request.exampleUrl;
  const bodyJson = JSON.stringify(postBody);
  for (const text of Object.values(docs)) {
    assert.ok(text.includes(extractUrl));
    assert.ok(text.includes(gatewayUrl));
    assert.ok(text.includes(bodyJson));
    assert.ok(/same payment-offer preflight product/i.test(text));
    assert.ok(/not a second catalog action/i.test(text));
    assert.equal(text.includes(`${origin}/security/wallet-policy-conformance?`), false);
  }
  assert.match(docs.githubSkill, /^---\nname: samedaydesk-machine-commerce\n/m);
  assert.match(docs.githubSkill, /X-SameDayDesk-Agent-Source: agent-skills-v1/);
  assert.match(docs.skillMd, /X-SameDayDesk-Agent-Source: agent-skills-v1/);
  assert.doesNotMatch(docs.githubSkill, /0\.005 USDC/);
  assert.doesNotMatch(docs.githubSkill, /\$0\.005/);
});

test("fails closed when a GET example omits a required query key", () => {
  const action = getAction({
    required: ["url", "mode"],
    exampleUrl: "https://agents.example/extract?url=https%3A%2F%2Fexample.com",
  });
  assert.throws(() => callableGetExample(action), /missing required query mode/);
});

test("fails closed on secret-like query keys, credentials, and transmissible POST URLs", () => {
  assert.throws(
    () => callableGetExample(getAction({
      queryParams: { api_token: "not-a-real-secret" },
      required: ["api_token"],
    })),
    /not safe to publish/,
  );
  assert.throws(
    () => callableGetExample(getAction({
      exampleUrl: "https://user:pass@agents.example/extract?url=https%3A%2F%2Fexample.com",
    })),
    /credential-free HTTPS/,
  );
  const leakedPost = postAction();
  leakedPost.request.exampleUrl = `${origin}/security/wallet-policy-conformance?profileId=privy-solana-lab`;
  assert.throws(() => postSchemaBodyExample(leakedPost), /must not publish a transmissible example URL/);

  const actions = [getAction(), postAction()];
  const docs = documents(actions);
  assert.throws(
    () => validatePublicationExampleParity({
      actions,
      documents: {
        ...docs,
        llms: `${docs.llms}\n- [POST /security/wallet-policy-conformance](${origin}/security/wallet-policy-conformance?profileId=x)`,
      },
    }),
    /transmissible POST URL/,
  );
  assert.throws(
    () => validatePublicationExampleParity({
      actions,
      documents: { llms: docs.llms.replace(actions[0].request.exampleUrl, `${origin}/extract`), skillMd: docs.skillMd, githubSkill: docs.githubSkill },
    }),
    /missing the callable GET example/,
  );
});
