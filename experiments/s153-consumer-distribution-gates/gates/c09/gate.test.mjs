import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c09 release-brief S1 positive-workflow", async () => {
  await runSituation("c09");
});
