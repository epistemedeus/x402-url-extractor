import { register } from "node:module";

const pgUrl = new URL("../node_modules/pg/lib/index.js", import.meta.url).href;
process.env.AE20_D_PG_URL = pgUrl;
register(new URL("./pg-resolve-hook.mjs", import.meta.url), { parentURL: import.meta.url });
await import("./qualify-x1-run.mjs");
