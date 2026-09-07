// Only test subprocesses opt into this preload; public commands use normal fetch.
import { DEFAULT_BATCH_AUTHORIZATION } from "../src/constants.mjs";
import { createBatchFixtureFetch, createFixtureFetch } from "../fixtures/transport.mjs";

const mode = process.env.CUSTOMER_X402_FIXTURE_MODE || "batch";
globalThis.fetch = mode === "get"
  ? createFixtureFetch().fetchImpl
  : createBatchFixtureFetch({ authorization: DEFAULT_BATCH_AUTHORIZATION }).fetchImpl;
