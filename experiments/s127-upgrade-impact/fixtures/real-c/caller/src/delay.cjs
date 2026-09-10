/**
 * Dual-structure control: CJS require of ms.
 * 3.0.0-beta.2 still publishes a require condition (lib/index.cjs).
 * This file is not the primary packet entry.
 */
"use strict";

const ms = require("ms");

function delayMs(spec) {
  return ms(spec);
}

module.exports = { delayMs };
