/**
 * S127 upgrade-impact: static import/require analysis (cell c03).
 * Implementation lives in cells/c03-static-imports/ (owned write path).
 */
export {
  SCHEMA,
  DEFAULT_EXTENSIONS,
  analyzeStaticImports,
  analyzeFileSource,
  matchesPackageSpecifier,
  inferLanguage,
  runCli,
} from "../cells/c03-static-imports/analyze.mjs";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCli } from "../cells/c03-static-imports/analyze.mjs";

const invoked =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  process.exit(runCli(process.argv.slice(2)));
}
