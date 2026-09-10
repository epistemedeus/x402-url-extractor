import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c24 table-reconcile S8 distributable-archive", async () => {
  await runSituation("c24");
});
