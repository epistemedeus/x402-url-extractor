import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjs = require("./lexer.js");

export const parse = cjs.parse;
export const init = cjs.init;
export const initSync = cjs.initSync;
