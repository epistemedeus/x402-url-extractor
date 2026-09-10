import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c37 replay-pack S5 cli-stdout-batch", async () => {
  await runSituation("c37");
});
