import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c18 table-reconcile S2 partial-prereq", async () => {
  await runSituation("c18");
});
