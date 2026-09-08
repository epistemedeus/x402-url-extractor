#!/usr/bin/env node
import { main } from "../src/page-change/cli.mjs";

process.exitCode = await main(process.argv.slice(2));
