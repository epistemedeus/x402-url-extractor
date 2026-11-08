import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { merchantMcpJsonSchema, merchantMcpStandardSchema } from "../../mcp-zod4-wire.mjs";
import { merchantInteger } from "../../merchant-zod4-values.mjs";

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

test("merchant output schemas project to JSON Schema and keep native Zod 4 validation", async () => {
  for (const [href, names] of catalogs) {
    const mod = await import(`../../${href.slice(2)}`);
    for (const name of names) {
      const schema = mod[name];
      assert.ok(schema, name);
      const standard = merchantMcpStandardSchema(schema);
      const json = standard["~standard"].jsonSchema.output();
      assert.equal(json.type, "object");
      assert.equal(typeof standard["~standard"].validate, "function");
      const rejected = standard["~standard"].validate({ ok: false });
      assert.ok(Array.isArray(rejected.issues) && rejected.issues.length > 0, name);
    }
  }
});

test("raw shapes, defaults, strict objects, and discriminated unions stay distinct", () => {
  const input = merchantMcpStandardSchema({
    note: z.string().min(1).max(20),
    limit: z.number().int().min(1).max(8).default(5),
  });
  const parsed = input["~standard"].validate({ note: "alpha", extra: true });
  assert.deepEqual(parsed.value, { note: "alpha", limit: 5 });
  const json = merchantMcpJsonSchema(z.object({
    mode: z.enum(["mcp", "openapi"]),
    child: z.object({ kind: z.literal("exact") }).strict(),
  }).strict());
  assert.equal(json.additionalProperties, false);
  assert.equal(json.properties.child.additionalProperties, false);
  assert.deepEqual(json.properties.mode.enum, ["mcp", "openapi"]);
  const union = merchantMcpJsonSchema(z.discriminatedUnion("protocol", [
    z.object({ protocol: z.literal("x402"), amount: z.string() }).strict(),
    z.object({ protocol: z.literal("mpp"), amount: z.string() }).strict(),
  ]));
  assert.equal(union.anyOf.length, 2);
  assert.equal(merchantMcpJsonSchema(z.object({})).additionalProperties, true);
});

test("native integer and optional values preserve the merchant's declared ranges and errors", () => {
  const schema = z.object({ count: merchantInteger(), maybe: z.unknown().optional() }).strict();
  const standard = merchantMcpStandardSchema(schema)["~standard"];
  assert.deepEqual(standard.validate({ count: 1e20 }).value, { count: 1e20 });
  assert.equal(standard.validate({ count: 0.5 }).issues[0].message, "Expected integer, received float");
  assert.equal(standard.validate({}).issues[0].message, "Required");
  assert.match(standard.validate({ count: 0, extra: true }).issues[0].message, /Unrecognized key\(s\)/);
  assert.equal(standard.jsonSchema.input().properties.count.type, "integer");
  assert.deepEqual(standard.jsonSchema.output().required, ["count"]);
});
