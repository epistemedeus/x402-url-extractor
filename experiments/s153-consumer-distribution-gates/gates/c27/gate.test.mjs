import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c27 link-index S3 conflict-identity", async () => {
  await runSituation("c27");
});
