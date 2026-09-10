import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c26 link-index S2 partial-prereq", async () => {
  await runSituation("c26");
});
