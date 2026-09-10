import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c47 freshness-receipt S7 coverage-integrity", async () => {
  await runSituation("c47");
});
