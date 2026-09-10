import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c15 release-brief S7 coverage-integrity", async () => {
  await runSituation("c15");
});
