import { readFile } from "node:fs/promises";
import path from "node:path";

import { readNdjson } from "./read.mjs";

const FILES = [
  "useful-result-customer.ndjson",
  "useful-result-metrics.ndjson",
  "useful-result-shared.ndjson",
  "commerce-outcome-task-ref.ndjson",
  "commerce-outcome-task-ref.1.ndjson",
  "commerce-events.ndjson",
  "commerce-outcome-binding.ndjson",
];

export async function readMerchantRecords(dataDir) {
  const records = [];
  let truncated = 0;
  const files = [];
  for (const name of FILES) {
    const text = await readFile(path.join(dataDir, name), "utf8").catch((error) => (
      error?.code === "ENOENT" ? null : Promise.reject(error)
    ));
    if (text == null) continue;
    const parsed = readNdjson(text);
    truncated += parsed.truncated;
    files.push({ name, rows: parsed.rows.length, truncated: parsed.truncated });
    records.push(...parsed.rows);
  }
  return { records, truncated, files };
}
