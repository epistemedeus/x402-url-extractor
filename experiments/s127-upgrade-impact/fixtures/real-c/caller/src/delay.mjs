/**
 * Primary case-C caller: ESM default import of ms.
 * Dual CJS/ESM 3.0.0-beta.2 still provides that default on the import condition.
 * Named parse/format are not imported (they are not public on either side of this pair).
 */
import ms from "ms";

export function delayMs(spec) {
  return ms(spec);
}
