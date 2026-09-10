import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c41 freshness-receipt S1 positive-workflow", async () => {
  await runSituation("c41");
});
