import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c42 freshness-receipt S2 partial-prereq", async () => {
  await runSituation("c42");
});
