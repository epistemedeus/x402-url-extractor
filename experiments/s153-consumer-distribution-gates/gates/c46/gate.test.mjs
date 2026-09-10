import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c46 freshness-receipt S6 import-roundtrip", async () => {
  await runSituation("c46");
});
