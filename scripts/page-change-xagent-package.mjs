#!/usr/bin/env node
/**
 * Build an exact source-only X-Agent review package from a public merchant
 * git commit (or the tracked worktree). Keeps first-party paths, including
 * vendor/change-digest. Does not download first-party source, sign RIGHTS.md,
 * open a PR, or claim live commit proof.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OFFICIAL_XAGT_PLUGIN_PIN = "422f0aeb5520a3506b08b05cfefcb76c6cb786c0";
export const DEFAULT_SLUG = "samedaydesk-page-change";
export const DEFAULT_NAME = "SameDayDesk page-change";
export const DEFAULT_SOURCE_REPOSITORY = "https://github.com/epistemedeus/x402-url-extractor";
export const DEFAULT_API_BASE_URL = "https://agents.samedaydesk.com";
export const DEFAULT_HEALTH_PATH = "/recipes/page-change/health";
export const DEFAULT_PROOF_PATH = "/.well-known/xagent-verification.json";
export const VENDOR_DIR = "examples/customer-x402/src/page-change/vendor/change-digest";
export const BLOCKED_DIR_NAMES = Object.freeze(["node_modules", ".git", "dist", "build", ".next"]);
export const CONTEST_WRAPPER_PREFIX = "experiments/s118-xagent/";
export const SECRET_FILENAME_RE = /(?:^|\/)\.env(?!.*example)|(?:^|\/)[^/]+\.(?:pem|p12|pfx|key)$/i;
export const VENDOR_SHA256 = Object.freeze({
  "compare.mjs": "86c9c0368755634a0a0674615bc38cc7d04664ab4aea9d54b1b60b611ec2ddec",
  "html-diff.mjs": "f6a401d751e14ad2ab9559cd7c5a4079d7e3b96402afc46f5bf0f8dec5254b8c",
  "json-diff.mjs": "45f022627f64d4acb2ff9029092bc7919a21ab64cc5bdc0f0600e72857689f2c",
  "limits.mjs": "58c264c931d87f7ef0d3b9303174c99b14dc4542592c24a1a49a4d4245cad739",
  "snapshot.mjs": "6853761f3c51a956c7252afac0b77f29d2d23f42ca729e5368022670b1681850",
  "text-diff.mjs": "7cc47a0df5e03335f79c24550c5839d0f5c4d1c75b1a4ff519b335bcd24c61ab",
});

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
];
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const merchantRootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function git(repo, args, encoding = "utf8") {
  return execFileSync("git", ["-C", repo, ...args], { encoding, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function posix(relativePath) {
  return String(relativePath).split(sep).join("/");
}

function pathBlockedByDirectory(relativePath) {
  const parts = posix(relativePath).split("/");
  return parts.find((part) => BLOCKED_DIR_NAMES.includes(part)) || null;
}

export function classifyPathExclusion(relativePath) {
  const path = posix(relativePath);
  if (path === CONTEST_WRAPPER_PREFIX.slice(0, -1) || path.startsWith(CONTEST_WRAPPER_PREFIX)) {
    return "contest_wrapper";
  }
  const blockedDir = pathBlockedByDirectory(path);
  if (blockedDir) return `blocked_directory:${blockedDir}`;
  if (SECRET_FILENAME_RE.test(path)) return "secret_filename";
  return null;
}

export function classifyExclusion(relativePath, bytes) {
  const pathReason = classifyPathExclusion(relativePath);
  if (pathReason) return pathReason;
  if (bytes && bytes.length >= 5 && bytes.subarray(0, 48).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
    return "lfs_pointer";
  }
  let text;
  try {
    text = bytes.toString("utf8");
  } catch {
    return null;
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) return "secret_content";
  return null;
}

export function listMerchantFiles(repoRoot, { commit = null } = {}) {
  const root = resolve(repoRoot);
  const names = commit
    ? git(root, ["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean)
    : git(root, ["ls-files", "-c", "-o", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  return [...new Set(names.map(posix))].sort();
}

function readMerchantFile(repoRoot, relativePath, { commit = null } = {}) {
  if (commit) return git(repoRoot, ["show", `${commit}:${relativePath}`], "buffer");
  return readFileSync(join(repoRoot, relativePath));
}

export function planPackageFiles(repoRoot, { commit = null } = {}) {
  const included = [];
  const excluded = [];
  for (const relativePath of listMerchantFiles(repoRoot, { commit })) {
    const pathReason = classifyPathExclusion(relativePath);
    if (pathReason) {
      excluded.push({ path: relativePath, reason: pathReason, bytes: 0, sha256: null });
      continue;
    }
    if (!commit) {
      const fullPath = join(repoRoot, relativePath);
      const details = lstatSync(fullPath);
      if (details.isSymbolicLink()) {
        excluded.push({ path: relativePath, reason: "symlink", bytes: 0, sha256: null });
        continue;
      }
      if (!details.isFile()) continue;
    }
    const bytes = readMerchantFile(repoRoot, relativePath, { commit });
    const reason = classifyExclusion(relativePath, bytes);
    if (reason) {
      excluded.push({ path: relativePath, reason, bytes: bytes.length, sha256: sha256(bytes) });
      continue;
    }
    included.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return { included, excluded };
}

export function verifyVendorPins(sourceRoot) {
  const vendorRoot = join(sourceRoot, ...VENDOR_DIR.split("/"));
  const results = [];
  for (const [name, digest] of Object.entries(VENDOR_SHA256)) {
    const bytes = readFileSync(join(vendorRoot, name));
    const actual = sha256(bytes);
    if (actual !== digest) throw new Error(`vendor pin mismatch for ${name}: ${actual} != ${digest}`);
    results.push({ path: `${VENDOR_DIR}/${name}`, sha256: actual });
  }
  const notice = readFileSync(join(vendorRoot, "NOTICE.md"), "utf8");
  if (!notice.includes("f4c6cff982f662ccfe65171b2ebb03b74cf4a986")) {
    throw new Error("vendor NOTICE is missing the reviewed C2 commit");
  }
  if (!existsSync(join(vendorRoot, "index.mjs"))) throw new Error("vendor index.mjs missing");
  return results;
}

function renderSubmissionMarkdown({ name, slug, reviewCommit, apiBaseUrl, healthCheckUrl, deploymentProofUrl, sourceRepository, fileCount, excluded }) {
  const exclusionLines = excluded.map((item) => `- \`${item.path}\` — ${item.reason}`).join("\n") || "- none";
  return `# ${name}

> Prepared review package. Not submitted. Not signed. Not an eligibility or acceptance claim.

## Capability

- **One-line description:** Compare two caller-supplied extract-batch JSON artifacts for an explicit field list and return a bounded change brief.
- **Who it helps:** Agents that already hold two batch JSON deliveries and need a field-scoped diff without a second fetch or payment.
- **Capability boundary:** Unpaid transform only. Does not fetch URLs, pay, schedule observations, raise caller limits, or add a paid SKU. Freshness stays unknown because the companion does not verify observation time.

## Live API

- **API base URL:** ${apiBaseUrl}
- **Health-check URL:** ${healthCheckUrl}
- **Authentication:** none for this companion
- **Rate limits / known limits:** 12 POST attempts per IP per minute; at most 2 concurrent compares per process; 5s shared deadline; 270,336-byte default request ceiling; 131,072 bytes per artifact; JSON depth 16; 4,096 JSON nodes; 32 sources; 11 fields. Operator env can only tighten ceilings.
- **API contract:** \`source/page-change-http.mjs\` OpenAPI at \`GET /recipes/page-change/openapi.json\`

## Source and reproducibility

- **Source repository:** ${sourceRepository}
- **Review commit:** \`${reviewCommit}\`
- **Source submitted in this PR:** \`source/\`
- **Run tests:** \`node --test page-change-http.test.mjs extract-batch-page-change.test.mjs\` from \`source/\` (stdlib; no first-party download)
- **Run locally:** from \`source/\`, \`PAGE_CHANGE_HTTP_ENABLED=1 node server.js\` after \`npm ci\` if the full merchant listener is required. The compare worker itself is stdlib-only.
- **Deploy:** existing public merchant at ${apiBaseUrl}. Do not change prices or the signed paid-routes JWS. Page-change is free and is not a paid route.
- **Version binding:** health reads host-injected \`RAILWAY_GIT_COMMIT_SHA\` or \`SOURCE_COMMIT\`. A local \`PAGE_CHANGE_SOURCE_COMMIT\` is used only when those host values are absent. Disagreeing pins are not emitted. Proof requires \`PAGE_CHANGE_XAGENT_SLUG\`.

The API must expose:

\`\`\`json
// GET ${healthCheckUrl}
{"status":"ok","commit":"${reviewCommit}"}
\`\`\`

\`\`\`json
// GET ${deploymentProofUrl}
{"schemaVersion":1,"slug":"${slug}","commit":"${reviewCommit}"}
\`\`\`

Live binding of commit and slug is an operator residual until the review commit is deployed with host git provenance and \`PAGE_CHANGE_XAGENT_SLUG=${slug}\`. Do not treat current live \`missing_source_commit\` / \`missing_slug\` as proof.

## Verification

Repeatable curls are in \`verification/README.md\`.

## Security and data handling

- **Data collected:** request JSON is compared in an owned worker and not retained. No raw-input logs.
- **Purpose and retention:** ephemeral compare. No observation archive.
- **Third parties / outbound network calls:** none for the compare itself. The live origin also serves unrelated paid merchant routes; this companion does not call them.
- **Secrets:** No secrets are committed in this package. Review access is not required.
- **Known risks / restrictions:** Caller timestamps cannot establish freshness. Duplicate active URLs are ambiguous. Partial/failed extract rows stay incomplete. This is not a live crawler.

## Package exclusions

Exact files come from the public merchant commit. These paths were omitted because the official validator would reject them or because they are contest-wrapper output, not capability source:

${exclusionLines}

The public Ed25519 deployment key remains at \`GET /.well-known/agent-payment-policy-service-deployment.pem\` on the live origin. It is not copied here because \`*.pem\` is a blocked filename. Do not rename \`vendor/\`.

Included source files: ${fileCount}.

## Support

- **Team / builder:** SameDayDesk
- **Contact:** contact@samedaydesk.com
- **License / rights:** MIT (repository root LICENSE). RIGHTS.md in this directory is an unsigned operator draft, not a signature.
`;
}

function renderRightsDraft({ name, slug }) {
  return `# UNSIGNED OPERATOR DRAFT — DO NOT SIGN OR SUBMIT

This file is a template fill copied from the official X-Agent RIGHTS template for operator review. It is **not signed**, is **not** an attestation, and is **not** a submission. Public MIT licensing is not authority to sign additional legal declarations. Root must replace this draft, sign only if actually authorized, and only then copy it into an external xagt-plugin PR.

---

# Submission rights declaration

Project: \`${name}\`
Submission slug: \`${slug}\`
Submitter: \`<legal person or entity — operator to fill>\`
Date: \`<YYYY-MM-DD — operator to fill>\`

The submitter confirms that they own, or have sufficient authorization for, the source code, dependencies, service, data, branding, and other materials submitted in this pull request.

Subject to the official program terms, the submitter authorizes X-Agent to retain, reproduce, audit, test, archive, and publish the submitted program artifact for judging, fraud prevention, dispute handling, ecosystem submission, and post-award accountability. Closing the pull request, deleting a fork, or deleting an external repository does not revoke the official archive rights attached to an accepted and rewarded entry.

Third-party components and their licenses:
- SameDayDesk first-party page-change recipe, HTTP companion, and vendored change-digest comparator: MIT (repository root \`LICENSE\`; \`source/${VENDOR_DIR}/NOTICE.md\`)
- In-repo C1 URL identity helper \`extract-batch-c1/url-guard.mjs\`: MIT
- npm runtime dependencies of the full merchant listener, if installed from the submitted lockfile: as declared in \`source/package-lock.json\`
- No first-party source is downloaded after validation

Exceptions or restrictions: unsigned draft; operator must complete submitter identity before any external PR. Page-change is a free companion on the existing merchant and is not a paid SKU.

This template is an operational declaration, not a substitute for event terms reviewed by qualified counsel.
`;
}

function renderVerificationReadme({ slug, reviewCommit, apiBaseUrl, healthCheckUrl, deploymentProofUrl }) {
  return `# Verification evidence

Review commit: \`${reviewCommit}\`
API base URL: \`${apiBaseUrl}\`
Authentication: none for the free page-change companion
Observed live residual (2026-09-10): health \`commitStatus: unavailable\` / \`missing_source_commit\`; proof \`missing_slug\`. That is the honest current host state, not a faked commit. Operator residual: deploy this review commit so Railway injects \`RAILWAY_GIT_COMMIT_SHA\`, and set \`PAGE_CHANGE_XAGENT_SLUG=${slug}\`.

## 1. Health check

\`\`\`bash
curl --fail --silent --show-error ${healthCheckUrl}
\`\`\`

Current live residual (before host binding):

\`\`\`json
{"ok":true,"status":"ok","enabled":true,"product":"samedaydesk-page-change-http","schemaVersion":"samedaydesk.page-change-http.v0","commitStatus":"unavailable","commit":null,"reason":"missing_source_commit"}
\`\`\`

After the review commit is deployed with host git provenance, expect \`status: ok\` and \`"commit":"${reviewCommit}"\`, plus response header \`x-source-commit: ${reviewCommit}\`.

## 2. Deployment proof

\`\`\`bash
curl --silent --show-error ${deploymentProofUrl}
\`\`\`

Current live residual:

\`\`\`json
{"ok":false,"error":"xagent_verification_unavailable","reason":"missing_slug"}
\`\`\`

After \`PAGE_CHANGE_XAGENT_SLUG=${slug}\` matches the host commit:

\`\`\`json
{"schemaVersion":1,"slug":"${slug}","commit":"${reviewCommit}"}
\`\`\`

## 3. Capability call

Use two already delivered batch JSON artifacts. The companion does not fetch or pay.

\`\`\`bash
jq -n --slurpfile before source/examples/customer-x402/fixtures/page-change/merchant/unchanged-before.json \\
     --slurpfile after source/examples/customer-x402/fixtures/page-change/merchant/unchanged-after.json \\
  '{before:$before[0],after:$after[0],fields:["title","description"]}' \\
  | curl --fail-with-body --silent --show-error \\
      -H 'Content-Type: application/json' \\
      --data-binary @- ${apiBaseUrl}/recipes/page-change
\`\`\`

Expected success: HTTP 200, \`charged: false\`, \`report.verdict: "unchanged"\`, \`report.claims.fresh: false\`, \`report.freshness: "unknown"\`.

Safe failure (freshness claim is refused):

\`\`\`bash
jq -n --slurpfile before source/examples/customer-x402/fixtures/page-change/merchant/unchanged-before.json \\
     --slurpfile after source/examples/customer-x402/fixtures/page-change/merchant/unchanged-after.json \\
  '{before:$before[0],after:$after[0],fields:["title"],allowFreshClaim:true}' \\
  | curl --silent --show-error -H 'Content-Type: application/json' --data-binary @- ${apiBaseUrl}/recipes/page-change
\`\`\`

Expected: HTTP 400, \`charged: false\`, freshness authority error. Filesystem paths are also 400. Live residual 2026-09-10 for \`before: "/tmp/before.json"\`:

\`\`\`json
{"ok":false,"product":"samedaydesk-page-change-http","schemaVersion":"samedaydesk.page-change-http.v0","charged":false,"error":"invalid_page_change_input","message":"before must be a supplied JSON artifact, not a filesystem path","code":"invalid_page_change_input"}
\`\`\`

## 4. Paid surface unchanged

\`\`\`bash
curl --fail --silent --show-error ${apiBaseUrl}/healthz
\`\`\`

\`prices\` must not include \`page-change\`. Do not treat the signed paid-routes JWS as covering this free companion.
`;
}

export async function buildPageChangePackage({
  repoRoot = merchantRootDefault,
  commit = null,
  worktree = false,
  outDir,
  slug = DEFAULT_SLUG,
  name = DEFAULT_NAME,
  sourceRepository = DEFAULT_SOURCE_REPOSITORY,
  apiBaseUrl = DEFAULT_API_BASE_URL,
  reviewCommit = null,
} = {}) {
  const root = resolve(repoRoot);
  if (!SLUG_PATTERN.test(slug) || slug.length > 80) throw new Error(`invalid slug: ${slug}`);
  if (!outDir) throw new Error("outDir is required");
  const output = resolve(outDir);
  const sourceModeCommit = worktree ? null : commit;
  if (!worktree) {
    if (!commit || !COMMIT_PATTERN.test(String(commit).toLowerCase())) {
      throw new Error("commit must be a 40-character git SHA unless worktree mode is set");
    }
    const resolved = git(root, ["rev-parse", "--verify", `${commit}^{commit}`]).trim().toLowerCase();
    if (resolved !== commit.toLowerCase()) throw new Error("commit does not resolve uniquely");
  }
  const declaredCommit = (reviewCommit || commit || git(root, ["rev-parse", "HEAD"]).trim()).toLowerCase();
  if (!COMMIT_PATTERN.test(declaredCommit)) throw new Error("reviewCommit must be a 40-character git SHA");

  const plan = planPackageFiles(root, { commit: sourceModeCommit });
  if (!plan.included.some((file) => file.path === `${VENDOR_DIR}/compare.mjs`)) {
    throw new Error("package is missing first-party vendor/change-digest source");
  }
  if (!plan.included.some((file) => file.path === "page-change-http.mjs")) {
    throw new Error("package is missing page-change-http.mjs");
  }

  await rm(output, { recursive: true, force: true });
  const sourceRoot = join(output, "source");
  const verificationRoot = join(output, "verification");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(verificationRoot, { recursive: true });

  for (const file of plan.included) {
    const bytes = readMerchantFile(root, file.path, { commit: sourceModeCommit });
    const destination = join(sourceRoot, ...file.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }

  const vendorPins = verifyVendorPins(sourceRoot);
  const healthCheckUrl = `${apiBaseUrl}${DEFAULT_HEALTH_PATH}`;
  const deploymentProofUrl = `${apiBaseUrl}${DEFAULT_PROOF_PATH}`;
  const manifest = {
    schemaVersion: 1,
    name,
    slug,
    sourceRepository,
    reviewCommit: declaredCommit,
    apiBaseUrl,
    healthCheckUrl,
    deploymentProofUrl,
  };
  const meta = {
    name,
    slug,
    reviewCommit: declaredCommit,
    apiBaseUrl,
    healthCheckUrl,
    deploymentProofUrl,
    sourceRepository,
    fileCount: plan.included.length,
    excluded: plan.excluded,
  };
  await writeFile(join(output, "SUBMISSION.md"), renderSubmissionMarkdown(meta));
  await writeFile(join(output, "RIGHTS.md"), renderRightsDraft({ name, slug }));
  await writeFile(join(output, "submission.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(verificationRoot, "README.md"), renderVerificationReadme(meta));
  await writeFile(join(output, "SOURCE_MANIFEST.json"), `${JSON.stringify({
    officialValidatorPin: OFFICIAL_XAGT_PLUGIN_PIN,
    sourceMode: worktree ? "worktree" : "commit",
    sourceCommit: sourceModeCommit,
    reviewCommit: declaredCommit,
    vendorDir: VENDOR_DIR,
    vendorPins,
    includedCount: plan.included.length,
    excludedCount: plan.excluded.length,
    included: plan.included,
    excluded: plan.excluded,
  }, null, 2)}\n`);

  return {
    outDir: output,
    slug,
    reviewCommit: declaredCommit,
    includedCount: plan.included.length,
    excludedCount: plan.excluded.length,
    vendorPins,
    manifest,
  };
}

function parseArgs(argv) {
  const options = { worktree: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--worktree") {
      options.worktree = true;
      continue;
    }
    if (value === "--commit" || value === "--out" || value === "--slug" || value === "--review-commit" || value === "--repo") {
      const mapped = value === "--out" ? "outDir" : value === "--review-commit" ? "reviewCommit" : value === "--repo" ? "repoRoot" : value.slice(2);
      options[mapped] = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unsupported option: ${value}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = options.repoRoot || merchantRootDefault;
  const outDir = options.outDir || join(repoRoot, "experiments/s118-xagent/submissions/mcp-hackathon", options.slug || DEFAULT_SLUG);
  const result = await buildPageChangePackage({
    repoRoot,
    commit: options.commit,
    worktree: options.worktree === true || !options.commit,
    outDir,
    slug: options.slug || DEFAULT_SLUG,
    reviewCommit: options.reviewCommit || options.commit,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, officialPin: OFFICIAL_XAGT_PLUGIN_PIN, result: {
    outDir: result.outDir,
    slug: result.slug,
    reviewCommit: result.reviewCommit,
    includedCount: result.includedCount,
    excludedCount: result.excludedCount,
    vendorPins: result.vendorPins,
  } }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
