import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c39 replay-pack S7 coverage-integrity", async () => {
  await runSituation("c39");
});
