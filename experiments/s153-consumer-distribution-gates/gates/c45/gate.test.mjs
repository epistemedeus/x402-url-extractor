import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c45 freshness-receipt S5 cli-stdout-batch", async () => {
  await runSituation("c45");
});
