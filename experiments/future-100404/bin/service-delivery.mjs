#!/usr/bin/env node
import { parseContract } from "../src/contract.mjs";
import { publicSummary, verifyReceipt } from "../src/consumer.mjs";
import { readJsonFile } from "../src/receipt-file.mjs";
import { runCallerDelivery } from "../src/caller.mjs";
import { assert, MAX_INPUT_BYTES } from "../src/value.mjs";

async function main(argv) {
  const [action, ...args] = argv;
  assert(["capture", "inspect", "validate"].includes(action), "command_required");
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    assert(["--contract", "--origin", "--receipt", "--prior", "--loopback-qa"].includes(flag) && !Object.hasOwn(flags, flag), "argument_rejected");
    flags[flag] = flag === "--loopback-qa" ? true : args[++i];
    assert(flags[flag] !== undefined, "argument_value_required");
  }
  assert(typeof flags["--receipt"] === "string", "receipt_required");
  if (action === "inspect") {
    assert(!flags["--contract"] && !flags["--origin"] && !flags["--prior"], "argument_rejected");
    return publicSummary(verifyReceipt(await readJsonFile(flags["--receipt"])));
  }
  assert(flags["--contract"] && flags["--origin"], "contract_and_origin_required");
  assert((action === "validate") === Boolean(flags["--prior"]), "prior_argument_rejected");
  const contract = parseContract(await readJsonFile(flags["--contract"], MAX_INPUT_BYTES));
  const prior = action === "validate" ? verifyReceipt(await readJsonFile(flags["--prior"])) : null;
  const options = { allowLoopback: flags["--loopback-qa"] === true,
    resultGrant: process.env.SERVICE_DELIVERY_RESULT_GRANT || null };
  return runCallerDelivery({ contract, origin: flags["--origin"], receipt: flags["--receipt"], prior }, options);
}

try {
  const summary = await main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(summary) + "\n");
  process.exitCode = summary.verdict === "fulfilled" ? 0 : 3;
} catch (error) {
  // No paths, raw provider errors, inputs, response bodies or credentials.
  const allowed = /^[a-z][a-z0-9_]{0,80}$/;
  process.stdout.write(JSON.stringify({ schema: "samedaydesk.service-delivery.cli-error.v1",
    error: allowed.test(error?.code || "") ? error.code : "consumer_input_or_receipt_unavailable",
    paymentPermitted: false, automaticReplay: false }) + "\n");
  process.exitCode = 2;
}
