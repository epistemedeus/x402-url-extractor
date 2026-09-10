import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c17 table-reconcile S1 positive-workflow", async () => {
  await runSituation("c17");
});
