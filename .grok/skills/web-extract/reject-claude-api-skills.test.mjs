import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));
const PINNED_SHA256 = "382e45d33e95b81dd27c2ab38c576118159a37af2d776bc0620ecf9b472d3551";
const LIVE_MCP_URL = "https://agents.samedaydesk.com/mcp";
const FILES = [
  "SKILL.md",
  "mcp.json",
  "runtime.json",
  "reject-claude-api-skills.mjs",
  "UNSUPPORTED.md",
];

function run(args, cwd = dir) {
  return spawnSync(process.execPath, [join(cwd, "reject-claude-api-skills.mjs"), ...args], {
    encoding: "utf8",
    cwd,
  });
}

function fixture(mutate) {
  const root = mkdtempSync(join(tmpdir(), "web-extract-skill-"));
  for (const name of FILES) copyFileSync(join(dir, name), join(root, name));
  mutate?.(root);
  return root;
}

function writeJson(root, name, mutate) {
  const path = join(root, name);
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("seeded failure: claude-api-skills exits 1", () => {
  const result = run(["claude-api-skills"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rejected runtime claude-api-skills/);
  assert.match(result.stderr, /no network/);
  assert.match(result.stderr, /agents\.samedaydesk\.com\/mcp/);
});

test("missing argv defaults to the claude-api-skills reject", () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rejected runtime claude-api-skills/);
});

test("supported runtimes exit 0 with the pinned MCP URL", () => {
  for (const id of ["cursor", "claude-code", "grok-bot"]) {
    const result = run([id]);
    assert.equal(result.status, 0, id);
    assert.equal(result.stdout, `supported runtime ${id}; mcp ${LIVE_MCP_URL}\n`);
  }
});

test("unknown runtime exits 2", () => {
  const result = run(["claude-api"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown runtime claude-api/);
});

test("SKILL.md sha256 matches runtime pin and live well-known digest", () => {
  const bytes = readFileSync(join(dir, "SKILL.md"));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const runtime = JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8"));
  const mcp = JSON.parse(readFileSync(join(dir, "mcp.json"), "utf8"));
  assert.equal(digest, PINNED_SHA256);
  assert.equal(runtime.liveSkillSha256, PINNED_SHA256);
  assert.equal(runtime.mcp.url, LIVE_MCP_URL);
  assert.equal(runtime.mcp.type, "http");
  assert.equal(runtime.mcp.protocolVersion, "2025-11-25");
  assert.equal(mcp.mcpServers.samedaydesk.url, LIVE_MCP_URL);
  assert.equal(mcp.mcpServers.samedaydesk.type, "http");
  assert.equal(mcp.mcpServers.samedaydesk.headers["X-SameDayDesk-Agent-Source"], "agent-skills-v1");
});

test("malformed runtime.json exits 2, not the reject signal 1", () => {
  const root = fixture((root) => writeFileSync(join(root, "runtime.json"), "{"));
  try {
    const result = run(["claude-api-skills"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /not valid JSON/);
    assert.doesNotMatch(result.stderr, /rejected runtime/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sha256 pin drift exits 2 even for the reject target", () => {
  const root = fixture((root) => {
    writeJson(root, "runtime.json", (runtime) => {
      runtime.liveSkillSha256 = "0".repeat(64);
    });
  });
  try {
    const result = run(["claude-api-skills"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not match runtime.liveSkillSha256/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("credential header is rejected before runtime classification", () => {
  const root = fixture((root) => {
    writeJson(root, "mcp.json", (mcp) => {
      mcp.mcpServers.samedaydesk.headers.Authorization = "Bearer secret";
    });
  });
  try {
    const result = run(["claude-api-skills"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /credential header Authorization/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP URL userinfo is rejected", () => {
  const root = fixture((root) => {
    const evil = "https://user:pass@agents.samedaydesk.com/mcp";
    writeJson(root, "mcp.json", (mcp) => {
      mcp.mcpServers.samedaydesk.url = evil;
    });
    writeJson(root, "runtime.json", (runtime) => {
      runtime.mcp.url = evil;
    });
  });
  try {
    const result = run(["cursor"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must not contain userinfo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP 2026-07-28 protocol pin is rejected", () => {
  const root = fixture((root) => {
    writeJson(root, "runtime.json", (runtime) => {
      runtime.mcp.protocolVersion = "2026-07-28";
    });
  });
  try {
    const result = run(["cursor"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /protocolVersion must be 2025-11-25/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("header CR/LF is rejected", () => {
  const root = fixture((root) => {
    writeJson(root, "mcp.json", (mcp) => {
      mcp.mcpServers.samedaydesk.headers["X-SameDayDesk-Agent-Source"] = "agent-skills-v1\r\nX-Injected: 1";
    });
  });
  try {
    const result = run(["cursor"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /must not contain CR or LF/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SKILL.md symlink is not followed", () => {
  const root = fixture();
  try {
    rmSync(join(root, "SKILL.md"));
    symlinkSync("/etc/passwd", join(root, "SKILL.md"));
    const result = run(["claude-api-skills"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot open/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("in-repo Cursor, Claude Code, and Grok copies stay byte-identical", () => {
  const repoRoot = join(dir, "../../..");
  const copies = [".cursor", ".claude", ".grok"].map((tree) => join(repoRoot, tree, "skills/web-extract"));
  const names = [...FILES, "reject-claude-api-skills.test.mjs"];
  const baseline = copies[0];
  for (const copy of copies.slice(1)) {
    for (const name of names) {
      assert.equal(
        readFileSync(join(copy, name)).equals(readFileSync(join(baseline, name))),
        true,
        `${copy} ${name} drifted from ${baseline}`,
      );
    }
  }
});
