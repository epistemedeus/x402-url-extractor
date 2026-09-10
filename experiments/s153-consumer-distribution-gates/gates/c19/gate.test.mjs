import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c19 table-reconcile S3 conflict-identity", async () => {
  await runSituation("c19");
});
