#!/usr/bin/env node
import { loadConfig, requireBaseUrl } from "../src/config.mjs";
import { createA2aServer } from "../src/a2a-server.mjs";
import { listen } from "../src/listen.mjs";

const config = loadConfig();
requireBaseUrl(config);
const server = createA2aServer(config);
const url = await listen(server, { port: config.port, urlFile: config.urlFile });
console.error(`AE20_D_A2A ${url}`);
