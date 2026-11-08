import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export const REVIEWED_SOURCE = Object.freeze({
  commit: "360fa586f936ef0d1c2daaafccf722da66b600ff",
  tree: "6c6bd5f1f831366d99d931466090e873ccc83aab",
  parents: Object.freeze([
    "f84e8f7e0fca9fdf2ce33ae24da2c364eb31b6ce",
    "24bdec0c7a1ef35dd7eab409364d7f8f6c7cca96",
  ]),
  version: "1.23.55",
});

export const ORIGINAL_AUDIT_PATH = "dependency-risk/audit-360fa586.json";
export const ORIGINAL_AUDIT_SHA256 = "9053f098b629af973b8ccf2513ca22f92cc9a773b0b1758fcdd9b8775d02f0bb";
export const ORIGINAL_AUDIT_COUNTS = Object.freeze({
  info: 0,
  low: 0,
  moderate: 5,
  high: 13,
  critical: 1,
  total: 19,
});


export const PAYMENT_PINS = Object.freeze({
  "@x402/core": "2.29.0",
  "@x402/evm": "2.29.0",
  "@x402/express": "2.29.0",
  "@x402/extensions": "2.29.0",
  "@x402/mcp": "2.29.0",
  "@x402/fetch": "2.29.0",
  axios: "1.20.0",
  mppx: "0.8.15",
  zod: "4.6.7",
});

export const PRODUCTION_ENTRIES = Object.freeze([
  "server.js",
  "page-change-mcp-stdio-probe.mjs",
]);

const INAPPLICABLE_BARE_PACKAGES = Object.freeze([
  "axios",
  "@coinbase/x402",
  "@coinbase/cdp-sdk",
  "zod/v3",
  "follow-redirects",
  "hono",
  "ip-address",
  "express-rate-limit",
]);

function ghsa(id) {
  return `https://github.com/advisories/${id}`;
}

export const FINDINGS = Object.freeze([
  {
    package: "proxy-addr",
    severity: "critical",
    exposure: "inapplicable",
    disposition: "patched",
    advisories: ["GHSA-jqcg-44mw-7w3h"],
    versions: { from: "2.0.7", to: "2.0.8" },
    summary: "Express loads proxy-addr for req.ip. trust proxy is the hop count 1, so the vulnerable subnet compiler is not configured. 2.0.8 stays inside Express's existing range and still trusts a correctly written IPv4-mapped prefix.",
  },
  {
    package: "body-parser",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "patched",
    advisories: ["GHSA-27r3-jxmh-p828"],
    versions: { lines: ["1.20.9", "2.4.0"] },
    summary: "express.json() inflates compressed bodies by default on ordinary routes and on POST /mcp. One gzip body plus trailing bytes used to crash the process after a normal response. Express 4 now resolves 1.20.9 and the SDK's Express 5 copy resolves 2.4.0.",
  },
  {
    package: "qs",
    severity: "moderate",
    exposure: "inapplicable",
    disposition: "patched",
    advisories: ["GHSA-6pq8-jhm2-2vcw"],
    versions: { from: "6.16.0", to: "6.16.2" },
    summary: "The crash is qs.stringify with arrayFormat comma, which Express and body-parser do not call. The existing override had pinned 6.16.0, the last vulnerable release. It now pins 6.16.2, and qs.parse of a normal query is unchanged.",
  },
  {
    package: "express",
    severity: "moderate",
    exposure: "inapplicable",
    disposition: "patched",
    inheritedFrom: "qs",
    advisories: [],
    versions: { stay: "4.22.2" },
    summary: "The Express 4 finding had no advisory of its own. npm attributed it to qs. Express stays 4.22.2.",
  },
  {
    package: "fast-uri",
    severity: "moderate",
    exposure: "inapplicable",
    disposition: "patched",
    advisories: [
      "GHSA-hrr3-gc8f-f4qj",
      "GHSA-w74x-v6f9-j3xg",
      "GHSA-xhq7-xmqj-769h",
      "GHSA-wjr9-j795-jxcr",
      "GHSA-333x-w4r6-6crp",
    ],
    versions: { from: "3.1.7", to: "3.1.9" },
    summary: "Ajv loads fast-uri as its schema URI resolver, and every McpServer constructs that Ajv with validateSchema false. Caller URLs are checked with the platform URL parser, not fast-uri. 3.1.9 is inside Ajv's existing range and no longer decodes a percent-encoded scheme into a live scheme.",
  },
  {
    package: "@modelcontextprotocol/sdk",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "patched",
    advisories: [
      "GHSA-f897-62hf-6gxq",
      "GHSA-46jr-4wx8-v453",
      "GHSA-6qxp-vccf-f47h",
      "GHSA-22jm-h49p-29qw",
      "GHSA-rvq5-wwqv-78pq",
      "GHSA-6prh-2h8m-c8cw",
    ],
    versions: { from: "1.30.0", to: "1.32.2" },
    summary: "POST /mcp and the free page-change MCP server pass a pre-parsed body to Streamable HTTP. 1.30.0 did not limit batch length on that path. 1.32.2 refuses more than 100 messages. Body size was already capped below the SDK default. maxToolInputElements is set because the validation cap ships off. OAuth client, taskStore, and bearer audience are not mounted. The server process does not follow client redirects.",
  },
  {
    package: "zod",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "partial",
    advisories: ["GHSA-mrhx-c7xc-m3w5"],
    versions: { stay: "3.25.76", zod4: "4.6.7" },
    summary: "No patched zod 3 release exists. @x402 2.16.0 and @coinbase/x402 2.1.0 require zod 3, so the direct copy stays 3.25.76. Nested zod 4 copies move to 4.6.7, which @modelcontextprotocol/core already loads. Tool-argument amplification is bounded by the existing body ceilings and maxToolInputElements.",
  },
  {
    package: "@coinbase/cdp-sdk",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    summary: "The finding is the shared zod 3 copy, not a CDP advisory. createFacilitatorConfig signs locally and does not upgrade the payment SDK.",
  },
  {
    package: "@coinbase/x402",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.1.0" },
    summary: "Kept at 2.1.0. Its postinstall script only prints a CDP terms notice. It does not fetch, write files, or sign.",
  },
  {
    package: "@x402/core",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.16.0" },
    summary: "The payment core stays on 2.16.0. npm's suggested jump to @x402/fetch 2.30.0 does not remove the zod 3 finding.",
  },
  {
    package: "@x402/evm",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.16.0" },
    summary: "Exact EVM verification stays on 2.16.0.",
  },
  {
    package: "@x402/express",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.16.0" },
    summary: "The Express payment middleware stays on 2.16.0.",
  },
  {
    package: "@x402/extensions",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.16.0" },
    summary: "Payment extensions stay on 2.16.0. npm offered no fix that keeps this line.",
  },
  {
    package: "@x402/mcp",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.16.0" },
    summary: "The MCP payment wrapper stays on 2.16.0 and already accepts SDK 1.32.2 through its existing range.",
  },
  {
    package: "@x402/fetch",
    severity: "high",
    exposure: "dev-build",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    versions: { stay: "2.16.0" },
    summary: "Direct devDependency. It is absent from npm audit --omit=dev and is not the production start path. The full 19-advisory report includes it.",
  },
  {
    package: "agent-payment-integrity",
    severity: "high",
    exposure: "reachable-runtime",
    disposition: "no-patch",
    inheritedFrom: "zod",
    advisories: [],
    summary: "The GitHub tarball depends on the pinned @x402 packages. The finding is inherited zod 3, and the tarball is unchanged.",
  },
  {
    package: "follow-redirects",
    severity: "high",
    exposure: "inapplicable",
    disposition: "no-patch",
    advisories: ["GHSA-q3jh-wrc6-jgq8", "GHSA-8r9p-f939-6h3c", "GHSA-mrwp-f3q8-3g9p"],
    versions: { stay: "1.16.0" },
    summary: "axios 1.20.0 is loaded because the CDP auth barrel imports its axios hook. The merchant never calls axios or withAuth. Facilitator HTTP goes through @x402/core. The three advisories need array-form headers, a sensitiveHeaders name that breaks the filter, or a cross-realm sensitiveHeaders array.",
  },
  {
    package: "hono",
    severity: "moderate",
    exposure: "inapplicable",
    disposition: "no-patch",
    advisories: [
      "GHSA-gqvv-2mrq-wpjv",
      "GHSA-g6gw-c38x-mqfc",
      "GHSA-crvj-82cr-hjcx",
      "GHSA-hxh3-vqpv-xpqv",
      "GHSA-5r4p-p66f-jhc7",
    ],
    versions: { stay: "4.13.1" },
    summary: "Streamable HTTP uses @hono/node-server getRequestListener. That listener does not call hono parseBody, toSSG, jsx, or hono serveStatic. The merchant does not import those entry points.",
  },
  {
    package: "ip-address",
    severity: "moderate",
    exposure: "inapplicable",
    disposition: "no-patch",
    advisories: [
      "GHSA-rpw4-54j3-4h4q",
      "GHSA-2vr4-cq9g-pvrc",
      "GHSA-j6r3-76f7-8jcv",
      "GHSA-h3mg-xc3c-68pw",
      "GHSA-rxp7-6hxx-x8q5",
    ],
    versions: { stay: "10.4.0" },
    summary: "express-rate-limit pulls ip-address for the SDK OAuth authorize handler. This server does not mount that handler or use Address6 as a trust or SSRF boundary. req.ip comes from Express hop-count trust.",
  },
]);

export function advisoryUrl(id) {
  return ghsa(id);
}

export function loadOriginalAudit(base = root) {
  const file = path.join(base, ORIGINAL_AUDIT_PATH);
  const bytes = readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ORIGINAL_AUDIT_SHA256) {
    throw new Error(`original audit digest changed: ${digest}`);
  }
  const audit = JSON.parse(bytes.toString("utf8"));
  const counts = audit?.metadata?.vulnerabilities;
  for (const key of Object.keys(ORIGINAL_AUDIT_COUNTS)) {
    if (counts?.[key] !== ORIGINAL_AUDIT_COUNTS[key]) {
      throw new Error(`original audit ${key} is ${counts?.[key]}, expected ${ORIGINAL_AUDIT_COUNTS[key]}`);
    }
  }
  return audit;
}

function ghsaIds(vulnerability) {
  const ids = new Set();
  for (const item of vulnerability?.via || []) {
    if (item && typeof item === "object" && typeof item.url === "string") {
      const match = item.url.match(/GHSA-[0-9a-z-]+/i);
      if (match) ids.add(match[0]);
    }
  }
  return [...ids];
}

export function requireOriginalClassification(audit) {
  const names = Object.keys(audit.vulnerabilities || {}).sort();
  const known = FINDINGS.map((finding) => finding.package).sort();
  if (names.join("\n") !== known.join("\n")) {
    throw new Error(`unclassified audit packages: got ${names.join(", ")}`);
  }
  const errors = [];
  for (const finding of FINDINGS) {
    const vulnerability = audit.vulnerabilities[finding.package];
    if (vulnerability.severity !== finding.severity) {
      errors.push(`${finding.package} severity ${vulnerability.severity} != ${finding.severity}`);
    }
    const ids = ghsaIds(vulnerability).sort();
    const expected = [...finding.advisories].sort();
    if (ids.join("\n") !== expected.join("\n")) {
      errors.push(`${finding.package} advisories ${ids.join(", ") || "(none)"} != ${expected.join(", ") || "(none)"}`);
    }
    if (!["reachable-runtime", "dev-build", "inapplicable", "unknown"].includes(finding.exposure)) {
      errors.push(`${finding.package} exposure ${finding.exposure}`);
    }
    if (!["patched", "partial", "no-patch"].includes(finding.disposition)) {
      errors.push(`${finding.package} disposition ${finding.disposition}`);
    }
    if (finding.exposure === "unknown") errors.push(`${finding.package} is still unknown`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return FINDINGS;
}

function versionsOf(lock, name) {
  const found = [];
  for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
    const resolved = meta?.name || (pkgPath.includes("node_modules/") ? pkgPath.split("node_modules/").pop() : "");
    if (resolved === name) found.push({ path: pkgPath || "(root)", version: meta.version, dev: meta.dev === true });
  }
  return found;
}

function fail(errors) {
  if (errors.length) throw new Error(errors.join("\n"));
}

export function assertReviewedClosure(lock) {
  const errors = [];
  const one = (name) => {
    const rows = versionsOf(lock, name);
    if (!rows.length) errors.push(`${name} missing`);
    return rows;
  };
  const proxy = one("proxy-addr");
  if (proxy.some((row) => row.version !== "2.0.8")) errors.push("proxy-addr must resolve to 2.0.8");
  const bodies = one("body-parser");
  for (const row of bodies) {
    const [major, minor, patch] = row.version.split(".").map(Number);
    const ok = (major === 1 && minor === 20 && patch >= 9) || (major === 2 && (minor > 4 || (minor === 4 && patch >= 0)));
    if (!ok) errors.push(`body-parser ${row.path} ${row.version} is below the patched line`);
  }
  if (one("qs").some((row) => row.version !== "6.16.2")) errors.push("qs override must resolve to 6.16.2");
  if (one("fast-uri").some((row) => row.version !== "3.1.9")) errors.push("fast-uri must resolve to 3.1.9");
  if (one("@modelcontextprotocol/sdk").some((row) => row.version !== "1.32.2")) {
    errors.push("@modelcontextprotocol/sdk must resolve to 1.32.2");
  }
  for (const name of ["@coinbase/x402", "@coinbase/cdp-sdk"]) {
    if (versionsOf(lock, name).length) errors.push(`${name} must be absent from the merchant lock`);
  }
  const jose = lock.packages?.["node_modules/jose"];
  if (jose?.version !== "6.2.3" || jose.dev) errors.push("production JOSE must resolve to 6.2.3");
  if (!one("axios").every((row) => row.dev)) errors.push("axios must be dev-only");
  for (const [name, version] of Object.entries(PAYMENT_PINS)) {
    const rows = one(name);
    if (name === "zod" && !rows.some((row) => row.path === "node_modules/zod" && !row.dev)) {
      errors.push("production zod must resolve at the root");
    }
    if (name.startsWith("@x402/") && (rows.length !== 1 || rows[0].path !== `node_modules/${name}`)) {
      errors.push(`${name} must resolve from one root installation`);
    }
    if (rows.some((row) => row.version !== version)) errors.push(`${name} must resolve to ${version}`);
  }
  const auditor = lock.packages?.["node_modules/agent-payment-integrity"];
  if (auditor?.resolved !== "https://github.com/epistemedeus/agent-payment-integrity/archive/91e920a22205c93773c70724b56bca7b6611542f.tar.gz"
      || auditor.integrity !== "sha512-Rr28T1XOU8Gkt/vEXYSF8DCrdUAW1pLQMjqB3bjgexFuPbjP5rH3A9FdvmS3NOpH+SrpKOsKOQBmhfqIrjuN0w=="
      || auditor.dependencies?.["@x402/core"] !== PAYMENT_PINS["@x402/core"]
      || auditor.dependencies?.["@x402/extensions"] !== PAYMENT_PINS["@x402/extensions"]) {
    errors.push("agent-payment-integrity must use the combined source and aligned payment packages");
  }
  const fetchRows = one("@x402/fetch");
  if (!fetchRows.every((row) => row.dev)) errors.push("@x402/fetch must stay a devDependency");
  for (const [name, version] of Object.entries({ "follow-redirects": "1.16.2", hono: "4.13.11", "ip-address": "10.7.4" })) {
    if (one(name).some((row) => row.version !== version)) errors.push(`${name} must resolve to ${version}`);
  }
  const express = one("express");
  if (!express.some((row) => row.path === "node_modules/express" && row.version === "4.22.3")) {
    errors.push("production express must resolve to 4.22.3");
  }
  fail(errors);
}

export function merchantProductionImports(base = root, entries = PRODUCTION_ENTRIES) {
  const seen = new Set();
  const bare = new Set();
  const unresolved = [];
  const dynamicNonLiteral = [];
  const fromRe = /\bfrom\s+["']([^"']+)["']/g;
  const sideRe = /\bimport\s+["']([^"']+)["']/g;
  const dynamicRe = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicAnyRe = /\bimport\s*\(/g;
  const localModuleRe = /(?:new URL\(\s*|loadOptional\(\s*|\(\s*)["'](\.[^"']+\.(?:mjs|js))["']/g;

  function visit(file) {
    const relative = path.relative(base, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return;
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const specs = [];
    for (const re of [fromRe, sideRe, dynamicRe]) {
      re.lastIndex = 0;
      for (const match of source.matchAll(re)) specs.push(match[1]);
    }
    dynamicAnyRe.lastIndex = 0;
    if (dynamicAnyRe.test(source)) {
      dynamicRe.lastIndex = 0;
      dynamicAnyRe.lastIndex = 0;
      const literals = [...source.matchAll(dynamicRe)].length;
      const calls = [...source.matchAll(dynamicAnyRe)].length;
      if (calls > literals) dynamicNonLiteral.push(relative);
    }
    localModuleRe.lastIndex = 0;
    for (const match of source.matchAll(localModuleRe)) specs.push(match[1]);
    for (const spec of specs) {
      if (spec.startsWith("node:") || spec.startsWith("data:") || (!spec.startsWith(".") && !spec.startsWith("/"))) {
        bare.add(spec);
        continue;
      }
      const resolved = resolveLocal(file, spec);
      if (!resolved) unresolved.push(`${relative} -> ${spec}`);
      else visit(resolved);
    }
  }

  function resolveLocal(fromFile, spec) {
    const basePath = path.resolve(path.dirname(fromFile), spec);
    const candidates = [
      basePath,
      `${basePath}.mjs`,
      `${basePath}.js`,
      path.join(basePath, "index.mjs"),
      path.join(basePath, "index.js"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  for (const entry of entries) visit(path.join(base, entry));
  return {
    files: [...seen].map((file) => path.relative(base, file)).sort(),
    bare: [...bare].sort(),
    unresolved,
    dynamicNonLiteral: dynamicNonLiteral.sort(),
  };
}

export function assertInapplicableImportsStayUncalled(graph = merchantProductionImports()) {
  const errors = [];
  for (const name of INAPPLICABLE_BARE_PACKAGES) {
    const hit = graph.bare.find((spec) => spec === name || spec.startsWith(`${name}/`));
    if (hit) errors.push(`production import uses ${hit}`);
  }
  if (!graph.bare.includes("express")) errors.push("production import walk did not reach express");
  if (!graph.bare.includes("jose")) errors.push("production import walk did not reach JOSE");
  if (!graph.bare.some((spec) => spec.startsWith("@modelcontextprotocol/sdk/"))) {
    errors.push("production import walk did not reach the MCP SDK");
  }
  if (graph.unresolved.length) errors.push(`unresolved production imports: ${graph.unresolved.join(", ")}`);
  fail(errors);
  return graph;
}
