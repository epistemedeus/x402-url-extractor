#!/usr/bin/env node
/**
 * Kit CLI entry. Delegates to the S137 consumer-evidence CLI (jobs 01-06 only).
 * Offline default. Does not fetch, pay, or publish.
 */
import { main } from "../../../s137-consumer-evidence-jobs/scripts/cli.mjs";

const code = await main(process.argv.slice(2));
process.exit(code ?? 0);
