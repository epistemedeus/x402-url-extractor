import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemas = JSON.parse(readFileSync(join(root, "contract/x1-schemas.json"), "utf8"));

export const CONTRACT_SCHEMAS = schemas;

// Three tools, one per X1 route. SDK 1.30 exposes experimental tasks; this adapter
// does not use them. registerTool would mark taskSupport forbidden anyway.
export const TOOLS = [
  {
    name: "url_extract_submit",
    title: "Submit URL extraction",
    description: "X1 route url.extract.submit. Schemas are copied from that route. jobId and digest pass through. Price 0. One execute, no retry.",
    routeId: "url.extract.submit",
    inputSchema: schemas.url_extract_submit_input,
    outputSchema: schemas.url_extract_submit_output,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "url_extract_status",
    title: "Poll URL extraction",
    description: "X1 route url.extract.poll. Schemas are copied from that route. jobId and digest pass through. Price 0. Does not submit.",
    routeId: "url.extract.poll",
    inputSchema: schemas.url_extract_poll_input,
    outputSchema: schemas.url_extract_poll_output,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "url_extract_result",
    title: "Read URL extraction",
    description: "X1 route url.extract.result. Schemas are copied from that route. jobId and digest pass through. Price 0. Does not submit.",
    routeId: "url.extract.result",
    inputSchema: schemas.url_extract_result_input,
    outputSchema: schemas.url_extract_result_output,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

export function toolByName(name) {
  return TOOLS.find((tool) => tool.name === name) || null;
}
