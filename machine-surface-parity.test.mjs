import assert from "node:assert/strict";
import test from "node:test";

import { listMcpToolMetadata } from "./mcp-tool-metadata.mjs";
import {
  CIRCLE_KILLED_SURFACES,
  SURFACE_POLICY,
  formatLlmsPrice,
  mcpToolNameForRoute,
  parseLlmsPaidRoutes,
  renderLlmsTxt,
  buildRootPaidRoutes,
  validateMachineSurfaceParity,
} from "./machine-surface-parity.mjs";

const origin = "https://agents.samedaydesk.com";
const extract = {
  name: "extract",
  method: "GET",
  route: "/extract",
  description: "URL -> structured JSON.",
  priceAtomicUsdc: "5000",
};
const protection = {
  name: "defi_morpho-protection",
  method: "GET",
  route: "/defi/morpho-protection",
  description: "Base Morpho borrower -> unsigned protection plans.",
  priceAtomicUsdc: "100000",
};
const policy = {
  name: "security_wallet-policy-conformance",
  method: "POST",
  route: "/security/wallet-policy-conformance",
  description: "Evaluate standardized wallet-policy observations.",
  priceAtomicUsdc: "10000",
};
const alternate = {
  product: "payment_offer_preflight",
  method: "GET",
  route: "/gateway/commerce/payment-offer-preflight",
  priceAtomicUsdc: "5000",
};
const actions = [extract, protection, policy];

function paidOp(method, route, operationId) {
  return {
    [method.toLowerCase()]: {
      operationId,
      "x-payment-info": { price: { amount: "0.005" } },
    },
  };
}

function surfaces(overrides = {}) {
  const catalog = {
    actions,
    alternateAccess: alternate,
  };
  const agentCard = {
    skills: [
      { id: "discover-x402-paid-actions", description: "catalog" },
      ...actions.map((action) => ({
        id: `discover-paid-action-${action.name}`,
        description: `Discover the direct ${action.route} machine-paid action.`,
      })),
    ],
  };
  const openapi = {
    paths: {
      "/extract": paidOp("GET", "/extract", "extractUrl"),
      "/defi/morpho-protection": paidOp("GET", "/defi/morpho-protection", "planMorphoProtection"),
      "/security/wallet-policy-conformance": paidOp("POST", "/security/wallet-policy-conformance", "evaluateWalletPolicyConformance"),
      "/gateway/commerce/payment-offer-preflight": paidOp("GET", "/gateway/commerce/payment-offer-preflight", "preflightPaymentOfferWithCircleGateway"),
    },
  };
  const mppOpenapi = {
    paths: {
      "/extract": paidOp("GET", "/extract", "extractUrl"),
      "/defi/morpho-protection": paidOp("GET", "/defi/morpho-protection", "planMorphoProtection"),
      "/security/wallet-policy-conformance": paidOp("POST", "/security/wallet-policy-conformance", "evaluateWalletPolicyConformance"),
    },
  };
  const manifestItems = [
    ...actions.map((action) => ({ resource: { routeTemplate: action.route } })),
    { resource: { routeTemplate: alternate.route } },
  ];
  const mcpToolNames = actions.map((action) => mcpToolNameForRoute(action.route));
  const llms = renderLlmsTxt({
    origin,
    facilitator: "cdp",
    payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    actions,
    alternate,
    buyerPolicyRelease: "https://github.com/epistemedeus/agent-payment-policy/releases/tag/v0.4.0",
    purchaseEvidencePath: "/.well-known/agent-payment-evidence.json",
  });
  return {
    actions,
    alternate,
    openapi,
    mppOpenapi,
    manifestItems,
    mcpToolNames,
    agentCard,
    catalog,
    llms,
    ...overrides,
  };
}

test("x402-only catalog actions are killed from MPP OpenAPI and kept on default OpenAPI", () => {
  const lockfile = {
    name: "lockfile_pin_delta",
    method: "POST",
    route: "/lockfile-pin-delta",
    description: "Compare lockfiles.",
    priceAtomicUsdc: "5000",
    paymentProtocols: ["x402"],
  };
  const withLockfile = surfaces({
    actions: [...actions, lockfile],
    catalog: { actions: [...actions, lockfile], alternateAccess: alternate },
    agentCard: {
      skills: [
        { id: "discover-x402-paid-actions", description: "catalog" },
        ...[...actions, lockfile].map((action) => ({
          id: `discover-paid-action-${action.name}`,
          description: `Discover the direct ${action.route} machine-paid action.`,
        })),
      ],
    },
    mcpToolNames: [...actions, lockfile].map((action) => mcpToolNameForRoute(action.route)),
  });
  withLockfile.openapi.paths["/lockfile-pin-delta"] = paidOp("POST", "/lockfile-pin-delta", "compareLockfilePinDelta");
  withLockfile.manifestItems.push({ resource: { routeTemplate: "/lockfile-pin-delta" } });
  withLockfile.llms = renderLlmsTxt({
    origin,
    facilitator: "cdp",
    payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
    actions: [...actions, lockfile],
    alternate,
    buyerPolicyRelease: "https://github.com/epistemedeus/agent-payment-policy/releases/tag/v0.4.0",
    purchaseEvidencePath: "/.well-known/agent-payment-evidence.json",
  });
  assert.equal(validateMachineSurfaceParity(withLockfile).ok, true);

  withLockfile.mppOpenapi.paths["/lockfile-pin-delta"] = paidOp("POST", "/lockfile-pin-delta", "compareLockfilePinDelta");
  assert.throws(
    () => validateMachineSurfaceParity(withLockfile),
    /must not appear on MPP OpenAPI/,
  );
});

test("kills Circle Gateway on MCP, A2A, catalog actions, and MPP OpenAPI", () => {
  assert.deepEqual(SURFACE_POLICY["circle-alternate"].mcp, "kill");
  assert.deepEqual(SURFACE_POLICY["circle-alternate"].a2a, "kill");
  assert.deepEqual(SURFACE_POLICY["circle-alternate"].actionCatalog, "kill");
  assert.deepEqual(SURFACE_POLICY["circle-alternate"].mppOpenapi, "kill");
  assert.deepEqual(
    CIRCLE_KILLED_SURFACES.slice().sort(),
    ["a2a", "actionCatalog", "mcp", "mppOpenapi"],
  );
});

test("maps HTTP routes to MCP tool names and formats llms prices", () => {
  assert.equal(mcpToolNameForRoute("/defi/morpho-protection"), "morpho_protection");
  assert.equal(mcpToolNameForRoute("/gateway/commerce/payment-offer-preflight"), "payment_offer_preflight");
  assert.equal(formatLlmsPrice("5000"), "$0.005");
  assert.equal(formatLlmsPrice("100000"), "$0.10");
  assert.equal(formatLlmsPrice("2000"), "$0.002");
  assert.equal(formatLlmsPrice("250000"), "$0.25");
});

test("renders every canonical paid route plus a labeled Circle alternate", () => {
  const llms = surfaces().llms;
  const listed = parseLlmsPaidRoutes(llms);
  assert.deepEqual(listed.map((entry) => entry.route), [
    "/extract",
    "/defi/morpho-protection",
    "/security/wallet-policy-conformance",
    "/gateway/commerce/payment-offer-preflight",
  ]);
  assert.equal(listed[1].price, "0.10");
  assert.equal(listed[2].method, "POST");
  assert.equal(listed[3].sameProduct, true);
  assert.match(llms, /\[POST \/security\/wallet-policy-conformance\]/);
  assert.match(llms, /same payment-offer preflight product/);
});

test("accepts exact OpenAPI, x402, MCP, A2A, catalog, llms, and Circle alternate parity", () => {
  assert.deepEqual(validateMachineSurfaceParity(surfaces()), {
    ok: true,
    actionCount: 3,
    llmsCanonicalCount: 3,
    llmsAlternateCount: 1,
    mcpToolCount: 3,
    killedCircleSurfaces: ["mppOpenapi", "mcp", "a2a", "actionCatalog"],
  });
});

test("fails when llms omits a canonical paid route, matching the 2026-08-20 snapshot", () => {
  const current = surfaces();
  const omitted = current.llms.replace(/^- \[\/defi\/morpho-protection\].*\n/m, "");
  assert.throws(
    () => validateMachineSurfaceParity(surfaces({ llms: omitted })),
    /\/defi\/morpho-protection is missing from llms.txt/,
  );
});

test("fails when Circle is promoted onto a killed surface", () => {
  const withCatalogAction = surfaces({
    catalog: { actions: [...actions, { ...extract, route: alternate.route }], alternateAccess: alternate },
  });
  assert.throws(() => validateMachineSurfaceParity(withCatalogAction), /must not appear as a catalog action/);

  const withA2a = surfaces();
  withA2a.agentCard.skills.push({
    id: "discover-paid-action-gateway",
    description: `Discover the direct ${alternate.route} machine-paid action.`,
  });
  assert.throws(() => validateMachineSurfaceParity(withA2a), /must not appear on the A2A agent card/);

  const withMpp = surfaces();
  withMpp.mppOpenapi.paths[alternate.route] = paidOp("GET", alternate.route, "circleOnMpp");
  assert.throws(() => validateMachineSurfaceParity(withMpp), /must not appear on MPP OpenAPI/);

  const withMcp = surfaces({ mcpToolNames: [...surfaces().mcpToolNames, "circle_gateway"] });
  assert.throws(() => validateMachineSurfaceParity(withMcp), /MCP tool names drifted/);
});

test("live MCP metadata still matches one tool per canonical route shape", () => {
  const names = listMcpToolMetadata().map((entry) => entry.name).sort();
  const freeNames = new Set(["page_change", "careers_board_cold", "report_caller_result"]);
  const paid = names.filter((name) => !freeNames.has(name));
  assert.equal(paid.length, 25);
  assert.ok(names.includes("page_change"));
  assert.ok(names.includes("careers_board"));
  assert.ok(names.includes("careers_board_cold"));
  assert.ok(names.includes("report_caller_result"));
  assert.ok(names.includes("extract_batch"));
  assert.ok(names.includes("lockfile_pin_delta"));
  assert.ok(names.includes("morpho_protection"));
  assert.ok(names.includes("opportunity_preflight"));
  assert.ok(names.includes("settlement_proof"));
  assert.ok(names.includes("transaction_receipt"));
  assert.ok(names.includes("solana_transaction_receipt"));
  assert.equal(paid.includes("circle_gateway"), false);
  assert.equal(paid.filter((name) => name === "payment_offer_preflight").length, 1);
});

test("maps extract/batch to extract_batch for MCP parity", () => {
  assert.equal(mcpToolNameForRoute("/extract/batch"), "extract_batch");
  assert.equal(mcpToolNameForRoute("/lockfile-pin-delta"), "lockfile_pin_delta");
  assert.equal(mcpToolNameForRoute("/extract"), "extract");
  assert.equal(mcpToolNameForRoute("/security/wallet-policy-conformance"), "wallet_policy_conformance");
});

test("root JSON derives configured actions, preserving hints without mutating the human map", () => {
  const careers = {
    method: "GET", route: "/data/careers-board", description: "Read a named careers board.",
    priceAtomicUsdc: "5000",
    request: { schema: { properties: { queryParams: { required: ["board"] } } } },
  };
  const hints = {
    "GET /extract?url=": "$999 - obsolete price",
    "GET /removed": "$1 - stale listing",
  };
  const before = structuredClone(hints);
  const root = buildRootPaidRoutes({
    actions: [...actions, careers],
    alternate: { ...alternate, description: "Same preflight via Circle." },
    hints,
  });
  assert.deepEqual(hints, before);
  assert.equal(root["GET /extract?url="], "$0.005 - URL -> structured JSON.");
  assert.equal(root["GET /data/careers-board?board="], "$0.005 - Read a named careers board.");
  assert.equal(Object.hasOwn(root, "GET /removed"), false);
  assert.equal(Object.hasOwn(root, "POST /security/wallet-policy-conformance"), true);
  assert.equal(Object.keys(root).length, actions.length + 2);
  assert.equal(Object.keys(buildRootPaidRoutes({ actions })).length, actions.length);
});

test("root parity rejects any missing, stale, duplicate or wrongly priced configured operation", () => {
  const root = buildRootPaidRoutes({ actions, alternate: { ...alternate, description: "Same preflight via Circle." } });
  assert.equal(validateMachineSurfaceParity(surfaces({ rootPaidRoutes: root })).ok, true);
  for (const label of Object.keys(root)) {
    const missing = { ...root };
    delete missing[label];
    assert.throws(() => validateMachineSurfaceParity(surfaces({ rootPaidRoutes: missing })), /missing from root paidRoutes/);
  }
  assert.throws(() => validateMachineSurfaceParity(surfaces({
    rootPaidRoutes: { ...root, "GET /stale": "$1 - stale" },
  })), /undeclared operation/);
  assert.throws(() => validateMachineSurfaceParity(surfaces({
    rootPaidRoutes: { ...root, "GET /extract?other=": root["GET /extract"] },
  })), /duplicate root paid operation/);
  assert.throws(() => validateMachineSurfaceParity(surfaces({
    rootPaidRoutes: { ...root, "GET /extract": "$0.50 - wrong" },
  })), /root price drifted/);
  const noAlternate = surfaces({ alternate: null });
  noAlternate.catalog.alternateAccess = null;
  noAlternate.rootPaidRoutes = buildRootPaidRoutes({ actions });
  assert.equal(validateMachineSurfaceParity(noAlternate).ok, true);
  noAlternate.rootPaidRoutes["GET " + alternate.route] = "$0.005 - stale alternate";
  assert.throws(() => validateMachineSurfaceParity(noAlternate), /undeclared operation/);
});

test("root builder refuses malformed or duplicate hints and does not invent free recipes", () => {
  assert.throws(() => buildRootPaidRoutes({ actions, hints: { "not a route": "bad" } }), /invalid root paid-route label/);
  assert.throws(() => buildRootPaidRoutes({
    actions, hints: { "GET /extract?url=": "a", "GET /extract?x=": "b" },
  }), /duplicate root paid operation/);
  const root = buildRootPaidRoutes({ actions });
  assert.equal(Object.keys(root).some((key) => key.includes("page-change") || key.includes("recipes/")), false);
});
