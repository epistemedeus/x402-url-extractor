import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c36 replay-pack S4 malformed-input", async () => {
  await runSituation("c36");
});
