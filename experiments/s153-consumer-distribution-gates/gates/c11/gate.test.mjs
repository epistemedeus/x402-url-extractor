import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c11 release-brief S3 conflict-identity", async () => {
  await runSituation("c11");
});
