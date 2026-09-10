import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c35 replay-pack S3 conflict-identity", async () => {
  await runSituation("c35");
});
