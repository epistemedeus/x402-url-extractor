// Only test subprocesses opt into this preload; public commands use normal fetch.
import { createFixtureFetch } from "../fixtures/transport.mjs";
globalThis.fetch = createFixtureFetch().fetchImpl;
