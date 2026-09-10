import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c21 table-reconcile S5 cli-stdout-batch", async () => {
  await runSituation("c21");
});
