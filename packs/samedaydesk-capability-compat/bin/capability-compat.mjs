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
} from "../src/index.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h", default: false },
    endpoint: { type: "string" },
    "client-sdk": { type: "string", default: OFFICIAL_CLIENT_NEGOTIATION.lockedCurrentClient },
    protocol: { type: "string", default: OFFICIAL_CLIENT_NEGOTIATION.refusedProtocol },
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
  capability-compat probe --endpoint <url> [--client-sdk 2.4.0] [--protocol 2026-07-28]
  capability-compat recover --endpoint <url> [--client-sdk 2.4.0]
  capability-compat compare --endpoint <url> [--client-sdk 2.4.0]
  capability-compat compare-acquisition [--tarball <file>] [--pack-dir <dir>]

probe detects an explicit protocol pin refusal (SdkError ${OFFICIAL_CLIENT_NEGOTIATION.pinClientErrorCode},
discover HTTP ${OFFICIAL_CLIENT_NEGOTIATION.discoverHttpStatus}, JSON-RPC ${OFFICIAL_CLIENT_NEGOTIATION.discoverJsonRpcCode}).
recover connects on ${OFFICIAL_CLIENT_NEGOTIATION.legacyProtocol} and completes tools/list after an unknown tool.
compare-acquisition records steps, wall time, and bytes only. The hosted side uses
retained Neomorphic tree bytes at ${PIN.sourcePins.neomorphic.sha} and never claims a live host.
`;
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
  } else if (command === "probe") {
    if (!values.endpoint) throw new Error("--endpoint is required");
    printJson(await detectPinRefusal({
      endpoint: values.endpoint,
      clientSdk: values["client-sdk"],
      protocol: values.protocol,
    }));
  } else if (command === "recover") {
    if (!values.endpoint) throw new Error("--endpoint is required");
    const recovered = await recoverToSupportedProtocol({
      endpoint: values.endpoint,
      clientSdk: values["client-sdk"],
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
      clientSdk: values["client-sdk"],
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
  process.stderr.write(`${error?.message || error}\n`);
  process.exit(1);
}
