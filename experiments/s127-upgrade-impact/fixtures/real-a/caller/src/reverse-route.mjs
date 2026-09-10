/**
 * Tiny caller against path-to-regexp@6.3.0 public CJS named exports.
 *
 * Used in value position (load-bearing):
 *   - tokensToFunction — exported in 6.3.0, not exported in 8.4.2
 *   - pathToRegexp    — exported in both; 6.3.0 is (path, keys, options) → RegExp
 *
 * Imported but unused (no value-position reference):
 *   - regexpToFunction — also removed in 8.4.2; unused export change ≠ caller defect
 *
 * Not imported: tokensToRegexp (removed), stringify / TokenData / PathError (added).
 */
import {
  pathToRegexp,
  tokensToFunction,
  regexpToFunction,
} from "path-to-regexp";

export function reverseFromTokens(tokens) {
  return tokensToFunction(tokens);
}

export function compilePattern(pattern) {
  const keys = [];
  const regexp = pathToRegexp(pattern, keys);
  return { regexp, keys };
}

export const PINNED_API = {
  usesV6OutParameterStyle: true,
};
