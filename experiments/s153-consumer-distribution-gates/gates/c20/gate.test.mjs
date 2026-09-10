import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c20 table-reconcile S4 malformed-input", async () => {
  await runSituation("c20");
});
