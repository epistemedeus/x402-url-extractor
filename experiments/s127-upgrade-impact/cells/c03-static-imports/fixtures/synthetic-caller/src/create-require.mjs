import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { alpha } = require("example-dep");
export { alpha };
