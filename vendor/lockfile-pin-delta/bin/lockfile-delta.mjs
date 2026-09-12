#!/usr/bin/env node
/**
 * Offline lockfile pin-delta. Parses package-lock.json only.
 * Does not spawn npm, does not audit, does not purchase.
 */
import { CliRefuse } from "../lib/errors.mjs";
import { parseArgs, usage } from "../lib/args.mjs";
import { runLockfileDelta } from "../lib/run.mjs";

function emit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(usage());
  process.exit(0);
}

try {
  const art = runLockfileDelta(args);
  emit(
    {
      ok: true,
      appId: "lockfile-pin-delta",
      status: art.status,
      provenance: art.provenance,
      digest: art.reportSha256,
      counts: art.counts,
      outDir: art.outDir,
      purchaseAuthority: false,
      settlement: "nonsettling-prototype",
    },
    0,
  );
} catch (err) {
  if (err instanceof CliRefuse) {
    emit(
      {
        ok: false,
        refused: true,
        code: err.code,
        error: err.message,
        detail: err.detail,
        purchaseAuthority: false,
      },
      err.exitCode,
    );
  }
  emit(
    {
      ok: false,
      refused: true,
      code: "internal-error",
      error: String(err?.message || err),
      purchaseAuthority: false,
    },
    1,
  );
}
