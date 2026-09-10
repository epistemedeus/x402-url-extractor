import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c33 replay-pack S1 positive-workflow", async () => {
  await runSituation("c33");
});
