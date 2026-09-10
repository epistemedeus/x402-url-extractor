import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c13 release-brief S5 cli-stdout-batch", async () => {
  await runSituation("c13");
});
