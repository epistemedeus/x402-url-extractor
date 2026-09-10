import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c03 migration-checklist S3 conflict-identity", async () => {
  await runSituation("c03");
});
