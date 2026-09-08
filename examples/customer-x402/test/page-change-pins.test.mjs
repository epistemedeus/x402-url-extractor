import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ALL_FIELDS, C2_COMMIT, MERCHANT_COMMIT } from "../src/page-change/constants.mjs";
import { assertMerchantSourceContract, inspectMerchantArtifact } from "../src/page-change/schema-contract.mjs";
import { vendorC2Root, merchantRoot } from "../src/page-change/provenance.mjs";
import { BATCH_SUPPORTED_FIELDS } from "../src/batch-admission.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const example = (...parts) => join(root, "..", "fixtures", "page-change", "customer-job", ...parts);
const fx = (...parts) => join(root, "..", "fixtures", "page-change", ...parts);

const VENDOR_SHA256 = Object.freeze({
  "compare.mjs": "86c9c0368755634a0a0674615bc38cc7d04664ab4aea9d54b1b60b611ec2ddec",
  "html-diff.mjs": "f6a401d751e14ad2ab9559cd7c5a4079d7e3b96402afc46f5bf0f8dec5254b8c",
  "json-diff.mjs": "45f022627f64d4acb2ff9029092bc7919a21ab64cc5bdc0f0600e72857689f2c",
  "limits.mjs": "58c264c931d87f7ef0d3b9303174c99b14dc4542592c24a1a49a4d4245cad739",
  "snapshot.mjs": "6853761f3c51a956c7252afac0b77f29d2d23f42ca729e5368022670b1681850",
  "text-diff.mjs": "7cc47a0df5e03335f79c24550c5839d0f5c4d1c75b1a4ff519b335bcd24c61ab",
});

test("vendored comparator files match reviewed C2 blobs", () => {
  const vendor = vendorC2Root();
  for (const [name, digest] of Object.entries(VENDOR_SHA256)) {
    const bytes = readFileSync(join(vendor, name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, name);
  }
  assert.equal(C2_COMMIT, "f4c6cff982f662ccfe65171b2ebb03b74cf4a986");
});

test("in-tree merchant still publishes extract-batch v0", () => {
  const contract = assertMerchantSourceContract();
  assert.ok(contract.facts.includes("outputSchema"));
  assert.ok(contract.facts.includes("fields"));
  const config = readFileSync(join(merchantRoot(), "extract-batch-config.mjs"), "utf8");
  assert.match(config, /samedaydesk-extract-batch/);
  assert.match(config, /samedaydesk\.extract-batch\.v0/);
  assert.equal(MERCHANT_COMMIT, "d7ceb857de7c25a0113e5b6914ff73a1c8afd760");
  assert.deepEqual([...ALL_FIELDS], [...BATCH_SUPPORTED_FIELDS]);
});

test("customer and merchant fixtures satisfy the public batch seller shape", () => {
  const files = [
    example("before.json"),
    example("after.json"),
    fx("merchant", "unchanged-before.json"),
    fx("merchant", "unchanged-after.json"),
    fx("merchant", "reordered-after.json"),
    fx("merchant", "duplicate-active.json"),
  ];
  for (const file of files) {
    const body = JSON.parse(readFileSync(file, "utf8"));
    const result = inspectMerchantArtifact(body);
    assert.equal(result.ok, true, `${file}: ${result.errors.join(",")}`);
  }
});

test("page-change recipe has no private git checkout or payment imports", () => {
  const dir = join(root, "..", "src", "page-change");
  const files = readdirSync(dir, { recursive: true })
    .filter((name) => String(name).endsWith(".mjs"))
    .map((name) => join(dir, name));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("git clone"), false, file);
    assert.equal(text.includes("PILOT_C2_ROOT"), false, file);
    assert.equal(text.includes("ensureC2Checkout"), false, file);
    assert.equal(text.includes("from \"../purchase.mjs\""), false, file);
    assert.equal(text.includes("from \"../wallet.mjs\""), false, file);
    assert.equal(text.includes("from \"../preflight.mjs\""), false, file);
  }
});
