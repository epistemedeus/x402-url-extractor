import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c31 link-index S7 coverage-integrity", async () => {
  await runSituation("c31");
});
