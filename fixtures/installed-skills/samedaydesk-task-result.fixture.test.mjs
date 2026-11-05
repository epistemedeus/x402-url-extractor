import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(root, "samedaydesk-task-result");
const INSTALLED_FILES = {
  "SKILL.md": { bytes: 3696, sha256: "83fd65e53ffd93c45e7915afa0fd7e271ce226cb2a63e6d17e32b644bad66254" },
  "scripts/task-result.mjs": { bytes: 34092, sha256: "8ad3a164db08a33233340b9db381da17047378be9e3965cdd90b7065ad95a4b6" },
  "references/caller-pin.json": { bytes: 3642, sha256: "7e6adbccf8436c90e23e3ee2338cbac093c33968628e5c5cae5c7d697abb13b7" },
  "references/LICENSE.txt": { bytes: 1071, sha256: "044d7291c37a2ead106ea4b4c26f713e63b7834637ed634da640f74e8cbe4625" },
};

test("in-repo installed skill fixture matches the journey INSTALLED_FILES pin", () => {
  assert.equal(existsSync(path.join(skillRoot, "scripts/task-result.mjs")), true);
  for (const [relative, expected] of Object.entries(INSTALLED_FILES)) {
    const bytes = readFileSync(path.join(skillRoot, relative));
    assert.equal(bytes.length, expected.bytes, relative);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256, relative);
  }
});

const downloadRoot = path.join(root, "caller-result-0.1.1-downloads/downloads/samedaydesk-caller-result/0.1.1");
const DOWNLOAD_FILES = {
  "descriptor.json": { bytes: 1422, sha256: "63e0249ee64cc287e586414db627d7224acfb25b81aa261e32505a33de5eaaac" },
  "provenance.json": { bytes: 1552, sha256: "fdcc880b190848385156b92625d0b93f12959d21317654e63a13646ef6e68dca" },
  "LICENSE": { bytes: 1068, sha256: "c9e2795d29bf1008cbd36ac045bd3c77d537438a51d8dda34e158f4e82a6a27c" },
  "SOURCE-NOTICE.txt": { bytes: 557, sha256: "45b2b240d5bbd8412a399b3bd5e93f38c3d30a8496e71693ab58a2177170e850" },
  "samedaydesk-caller-result-0.1.1.tar.gz": { bytes: 32421, sha256: "693652564f9cd587e4c269ff4da4653c19b1c68f42c3debe5241f34f42bf9de3" },
};

test("offline caller-result download pin matches the sealed skill PIN.files hashes", () => {
  for (const [relative, expected] of Object.entries(DOWNLOAD_FILES)) {
    const bytes = readFileSync(path.join(downloadRoot, relative));
    assert.equal(bytes.length, expected.bytes, relative);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected.sha256, relative);
  }
});
