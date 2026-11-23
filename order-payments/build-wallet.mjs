import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({ absWorkingDir: fileURLToPath(new URL(".", import.meta.url)), entryPoints: ["wallet.js"],
  bundle: true, minify: true, format: "esm", target: "es2022", outfile: "dist/wallet.js", legalComments: "inline" });
