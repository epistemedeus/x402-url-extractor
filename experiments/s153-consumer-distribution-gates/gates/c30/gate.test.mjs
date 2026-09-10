import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c30 link-index S6 import-roundtrip", async () => {
  await runSituation("c30");
});
