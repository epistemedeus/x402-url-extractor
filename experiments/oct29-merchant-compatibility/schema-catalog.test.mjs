import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { zod3JsonSchema, zod3StandardSchema } from "../../mcp-zod3-json-schema.mjs";

const catalogs = [
  ["./extract.mjs", ["extractMcpOutputSchema", "readMcpOutputSchema"]],
  ["./scan.mjs", ["scanRepoMcpOutputSchema"]],
  ["./morpho-protection.mjs", ["morphoProtectionMcpOutputSchema"]],
  ["./morpho-preliquidation-replay.mjs", ["morphoPreLiquidationReplayMcpOutputSchema"]],
  ["./opportunity-preflight.mjs", ["opportunityPreflightMcpOutputSchema"]],
  ["./payment-offer-preflight.mjs", ["paymentOfferPreflightMcpOutputSchema"]],
  ["./contract-qualified-search.mjs", ["contractQualifiedSearchMcpOutputSchema"]],
  ["./agent-surface-budget-audit.mjs", ["agentSurfaceBudgetAuditMcpOutputSchema"]],
  ["./settlement-proof.mjs", ["settlementProofMcpOutputSchema"]],
  ["./wallet-policy-conformance.mjs", ["walletPolicyConformanceMcpOutputSchema"]],
  ["./stateful-wallet-policy-conformance.mjs", ["statefulWalletPolicyConformanceMcpOutputSchema"]],
  ["./extract-batch.mjs", ["extractBatchMcpOutputSchema"]],
  ["./lockfile-pin-delta.mjs", ["lockfilePinDeltaMcpOutputSchema"]],
  ["./extraction-trial.mjs", ["trialReadMcpOutputSchema"]],
];

test("merchant output schemas project to JSON Schema and keep Zod 3 validation", async () => {
  for (const [href, names] of catalogs) {
    const mod = await import(`../../${href.slice(2)}`);
    for (const name of names) {
      const schema = mod[name];
      assert.ok(schema, name);
      const standard = zod3StandardSchema(schema);
      const json = standard["~standard"].jsonSchema.output();
      assert.equal(json.type, "object");
      assert.equal(typeof standard["~standard"].validate, "function");
      const rejected = standard["~standard"].validate({ ok: false });
      assert.ok(Array.isArray(rejected.issues) && rejected.issues.length > 0, name);
    }
  }
});

test("raw shapes, defaults, strict objects, and discriminated unions stay distinct", () => {
  const input = zod3StandardSchema({
    note: z.string().min(1).max(20),
    limit: z.number().int().min(1).max(8).default(5),
  });
  const parsed = input["~standard"].validate({ note: "alpha", extra: true });
  assert.deepEqual(parsed.value, { note: "alpha", limit: 5 });
  const json = zod3JsonSchema(z.object({
    mode: z.enum(["mcp", "openapi"]),
    child: z.object({ kind: z.literal("exact") }).strict(),
  }).strict());
  assert.equal(json.additionalProperties, false);
  assert.equal(json.properties.child.additionalProperties, false);
  assert.deepEqual(json.properties.mode.enum, ["mcp", "openapi"]);
  const union = zod3JsonSchema(z.discriminatedUnion("protocol", [
    z.object({ protocol: z.literal("x402"), amount: z.string() }).strict(),
    z.object({ protocol: z.literal("mpp"), amount: z.string() }).strict(),
  ]));
  assert.equal(union.anyOf.length, 2);
  assert.equal(zod3JsonSchema(z.object({})).additionalProperties, true);
});
