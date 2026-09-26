import { CLIENT_VERSION, EXAMPLE_ID, REPORT_SCHEMA, WORK_ITEM } from "./constants.mjs";
import { unpaidBoundary } from "./boundary.mjs";

export function envelope(body) {
  return {
    schema: REPORT_SCHEMA,
    schemaVersion: 1,
    example: EXAMPLE_ID,
    workItem: WORK_ITEM,
    version: CLIENT_VERSION,
    checkedAt: new Date().toISOString(),
    node: { wanted: "22.x", actual: process.version },
    boundary: body.boundary || unpaidBoundary(),
    ...body,
  };
}

export function printHuman(report) {
  const status = report.ok ? "pass" : "fail";
  const lines = [`samedaydesk w1032 unpaid list  ${status}  ${report.command}`];
  if (report.mcpUrl) lines.push(`  mcp  ${report.mcpUrl}`);
  if (report.transport) lines.push(`  transport  ${report.transport}`);
  if (report.protocolVersion) lines.push(`  protocol  ${report.protocolVersion}`);
  if (report.serverInfo) {
    lines.push(`  server  ${report.serverInfo.name} ${report.serverInfo.version || ""}`.trimEnd());
  }
  if (typeof report.toolCount === "number") lines.push(`  tools  ${report.toolCount}`);
  if (report.requiredPresent) {
    lines.push(`  required  ${Object.keys(report.requiredPresent).join(", ")}`);
  }
  if (report.seed) lines.push(`  seed  ${report.seed.id}  ${report.result?.status || ""}`.trimEnd());
  if (report.boundary) {
    lines.push(
      `  paymentSent  ${report.boundary.paymentSent}  toolsCalled  ${report.boundary.toolsCalled}  published  ${report.boundary.published}  neoUsed  ${report.boundary.neoUsed}`,
    );
  }
  if (report.error) lines.push(`${report.error.code}: ${report.error.message}`);
  return `${lines.join("\n")}\n`;
}

export function emit(report, json, stream = process.stdout, errStream = process.stderr) {
  if (json) stream.write(`${JSON.stringify(report, null, 2)}\n`);
  else stream.write(printHuman(report));
  if (report.error) errStream.write(`${report.error.code}: ${report.error.message}\n`);
}
