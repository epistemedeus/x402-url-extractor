import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c34 replay-pack S2 partial-prereq", async () => {
  await runSituation("c34");
});
