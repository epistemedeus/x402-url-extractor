import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c43 freshness-receipt S3 conflict-identity", async () => {
  await runSituation("c43");
});
