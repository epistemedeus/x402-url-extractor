#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  PIN,
  FREE_PAGE_CHANGE,
  OFFICIAL_CLIENT_NEGOTIATION,
  compareHeldPages,
  detectPinRefusal,
  recoverToSupportedProtocol,
  recoverUnknownTool,
  compareInstalledVsHosted,
  describeCapabilities,
  exitCodeForEnvelope,
  diagnosticForEnvelope,
} from "../src/index.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h", default: false },
    endpoint: { type: "string" },
    "client-sdk": { type: "string" },
    protocol: { type: "string" },
    "protocol-pin": { type: "string" },
    "expected-source-sha": { type: "string" },
    "expected-source-repo": { type: "string" },
    "pack-dir": { type: "string" },
    tarball: { type: "string" },
  },
});

const command = positionals[0] || "help";

function usage() {
  return `samedaydesk-capability-compat ${PIN.version}

Installable capability pack for official MCP client and protocol changes on
the free page-change profile. Charged is always false. No paid calls.

Usage:
  capability-compat help
  capability-compat pin
  capability-compat describe --endpoint <url> [--client-sdk 2.4.0] [--protocol-pin 2026-07-28]
      [--expected-source-sha <sha>] [--expected-source-repo <repo>]
  capability-compat probe --endpoint <url> [--client-sdk 2.4.0] [--protocol 2026-07-28]
  capability-compat recover --endpoint <url> [--client-sdk 2.4.0]
  capability-compat compare --endpoint <url> [--client-sdk 2.4.0]
  capability-compat compare-acquisition [--tarball <file>] [--pack-dir <dir>]

describe writes a samedaydesk.capability-provider.preview.v1 envelope to stdout.
Diagnostics go to stderr as one samedaydesk.cli.diagnostic.v1 line on failure.
The provider function itself never writes to stdout or stderr and never reads
process.env; this bin maps --protocol-pin to SAMEDAYDESK_MCP_PROTOCOL only
and does not forward process.env.

probe detects an explicit protocol pin refusal (SdkError ${OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode},
discover HTTP ${OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus}, JSON-RPC ${OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode}).
recover connects on ${OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol} and completes tools/list after an unknown tool.
compare-acquisition records steps, wall time, and bytes only. The hosted side uses
retained Neomorphic tree bytes at ${PIN.sourcePins.neomorphic.sha} and never claims a live host.
`;
}

function writeStdout(value) {
  process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function writeDiagnostic(envelope, exit) {
  process.stderr.write(`${JSON.stringify(diagnosticForEnvelope(envelope, exit))}\n`);
}

function emitPreview(envelope) {
  if (envelope?.paymentSignature != null) {
    const refused = {
      schema: "samedaydesk.capability-provider.preview.v1",
      ok: false,
      observedAt: envelope.observedAt || new Date().toISOString(),
      provider: envelope.provider || { package: PIN.package, version: PIN.version },
      error: {
        code: "response_invalid",
        retryable: false,
        recovery: {
          action: "none",
          instruction: "Refuse the result. paymentSignature must be null and the body must match the preview schema.",
        },
      },
      paymentSignature: null,
    };
    const exit = exitCodeForEnvelope(refused);
    writeStdout(refused);
    writeDiagnostic(refused, exit);
    process.exit(exit);
  }
  writeStdout(envelope);
  const exit = exitCodeForEnvelope(envelope);
  if (exit !== 0) writeDiagnostic(envelope, exit);
  process.exit(exit);
}

if (values.help || command === "help") {
  process.stdout.write(usage());
  process.exit(0);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (command === "pin") {
    printJson({ package: PIN.package, version: PIN.version, path: FREE_PAGE_CHANGE.path, tool: FREE_PAGE_CHANGE.tool, pins: PIN.sourcePins, protocols: PIN.protocols });
  } else if (command === "describe") {
    if (!values.endpoint) throw new Error("--endpoint is required");
    const env = {};
    const pin = values["protocol-pin"];
    if (pin) env.SAMEDAYDESK_MCP_PROTOCOL = pin;
    const expectedSource = values["expected-source-sha"]
      ? {
          repo: values["expected-source-repo"] || PIN.sourcePins.merchant.repo,
          sha: values["expected-source-sha"],
        }
      : undefined;
    const envelope = await describeCapabilities({
      endpoint: values.endpoint,
      clientSdk: values["client-sdk"],
      expectedSource,
      env: Object.keys(env).length ? env : undefined,
    });
    emitPreview(envelope);
  } else if (command === "probe") {
    if (!values.endpoint) throw new Error("--endpoint is required");
    printJson(await detectPinRefusal({
      endpoint: values.endpoint,
      clientSdk: values["client-sdk"] || OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient,
      protocol: values.protocol || OFFICIAL_CLIENT_NEGOTIATION.refusedProtocol,
    }));
  } else if (command === "recover") {
    if (!values.endpoint) throw new Error("--endpoint is required");
    const recovered = await recoverToSupportedProtocol({
      endpoint: values.endpoint,
      clientSdk: values["client-sdk"] || OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient,
    });
    try {
      const unknown = await recoverUnknownTool({ session: recovered.session });
      printJson({
        protocol: recovered.protocol,
        listed: unknown.listed,
        charged: unknown.body.charged,
        verdict: unknown.body.report?.verdict ?? null,
      });
    } finally {
      await recovered.session.close();
    }
  } else if (command === "compare") {
    if (!values.endpoint) throw new Error("--endpoint is required");
    const compared = await compareHeldPages({
      endpoint: values.endpoint,
      clientSdk: values["client-sdk"] || OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient,
    });
    printJson({
      protocol: compared.protocol,
      tools: compared.tools,
      charged: compared.charged,
      verdict: compared.verdict,
      paymentSignature: compared.paymentSignature,
    });
  } else if (command === "compare-acquisition") {
    printJson(compareInstalledVsHosted({
      installedTarballPath: values.tarball || null,
      packDirectory: values["pack-dir"] || null,
    }));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  const exit = 1;
  const diagnostic = { schema: "samedaydesk.cli.diagnostic.v1", code: "invalid_arguments", exit };
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
  process.exit(exit);
}
