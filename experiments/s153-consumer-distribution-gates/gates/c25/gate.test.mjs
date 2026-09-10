import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c25 link-index S1 positive-workflow", async () => {
  await runSituation("c25");
});
