import test from "node:test";
import { runSituation } from "../_harness/situations.mjs";

test("c06 migration-checklist S6 import-roundtrip", async () => {
  await runSituation("c06");
});
