import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c23 table-reconcile S7 coverage-integrity", async () => {
  await runSituation("c23");
});
