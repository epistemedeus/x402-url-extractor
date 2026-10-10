// Offline reader for one prospective delivery fixture directory.
// It prints the public aggregate only. It does not sign, pay, or query a ledger service.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { readProspectiveDelivery } from "./commerce-prospective-delivery.mjs";

const dir = process.argv[2];
if (!dir) {
  process.stderr.write("usage: node commerce-prospective-delivery-cold.mjs <fixture-dir>\n");
  process.exit(2);
}
const ledger = await readFile(path.join(dir, "commerce-settlements.ndjson"), "utf8");
const generatedAt = process.env.PROSPECTIVE_GENERATED_AT || new Date().toISOString();
const packet = await readProspectiveDelivery({ dataDir: dir, ledger, generatedAt });
process.stdout.write(`${JSON.stringify(packet)}\n`);
