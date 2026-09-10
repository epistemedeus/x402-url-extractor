#!/usr/bin/env node
import { runCli } from "./analyze.mjs";

process.exit(runCli(process.argv.slice(2)));
