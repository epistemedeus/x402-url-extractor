import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c22 table-reconcile S6 import-roundtrip", async () => {
  await runSituation("c22");
});
