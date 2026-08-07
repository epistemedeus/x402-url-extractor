import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const benchmarkRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(process.argv[2] ?? "/workspace");
const checker = join(sourceRoot, "scripts", "check-x402-manifest.mjs");
const expectedBase = "https://x402-url-extractor-production.up.railway.app";
const expectedPayee = "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee";
const requiredRoutes = [
  "/deep-audit",
  "/enrich",
  "/extract",
  "/read",
  "/scan",
  "/schemaforge",
  "/wallet-enrich",
];

if (!existsSync(checker)) {
  console.error(`missing child implementation: ${checker}`);
  process.exit(1);
}

const fixtureRoot = join(benchmarkRoot, "fixtures");
const validPath = join(fixtureRoot, "valid.json");
const validBytes = readFileSync(validPath);
const valid = JSON.parse(validBytes);
const temporary = mkdtempSync(join(tmpdir(), "sdd-x402-manifest-benchmark-"));

function mutate(name, change) {
  const value = structuredClone(valid);
  change(value);
  const path = join(temporary, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function failure(...errors) {
  return { ready: false, errors };
}

const cases = [
  {
    name: "missing arguments",
    args: [],
    status: 2,
    output: failure("arguments_required"),
  },
  {
    name: "unreadable manifest",
    args: [join(fixtureRoot, "absent.json"), expectedBase, expectedPayee],
    status: 2,
    output: failure("manifest_unreadable"),
  },
  {
    name: "malformed JSON",
    args: [join(fixtureRoot, "malformed.json"), expectedBase, expectedPayee],
    status: 2,
    output: failure("manifest_invalid_json"),
  },
  {
    name: "non-object root",
    args: [join(fixtureRoot, "not-an-object.json"), expectedBase, expectedPayee],
    status: 2,
    output: failure("manifest_root_object_required"),
  },
  {
    name: "invalid root and item",
    args: [
      mutate("invalid-root-item", (value) => {
        value.x402Version = 1;
        value.items = [null];
      }),
      expectedBase,
      expectedPayee,
    ],
    status: 1,
    output: failure(
      "x402_version_mismatch",
      "item_object_required:0",
      ...requiredRoutes.map((route) => `required_route_missing:${route}`),
    ),
  },
  {
    name: "wrong item and payment fields",
    args: [
      mutate("wrong-fields", (value) => {
        const item = value.items[0];
        item.type = "mcp";
        item.resource.description = "";
        item.resource.mimeType = "text/plain";
        const payment = item.accepts[0];
        payment.scheme = "upto";
        payment.network = "eip155:84532";
        payment.asset = "0x1111111111111111111111111111111111111111";
        payment.amount = "0";
        payment.payTo = "0x2222222222222222222222222222222222222222";
        payment.maxTimeoutSeconds = 301;
      }),
      expectedBase,
      expectedPayee,
    ],
    status: 1,
    output: failure(
      "item_type_mismatch:0",
      "resource_description_required:0",
      "resource_mime_mismatch:0",
      "payment_scheme_mismatch:0",
      "payment_network_mismatch:0",
      "payment_asset_mismatch:0",
      "payment_amount_invalid:0",
      "payment_payee_mismatch:0",
      "payment_timeout_invalid:0",
    ),
  },
  {
    name: "wrong origin and duplicate route",
    args: [
      mutate("origin-duplicate", (value) => {
        value.items[0].resource.url = "https://wrong.example/extract";
        value.items[6].resource.url = value.items[1].resource.url;
      }),
      expectedBase,
      expectedPayee,
    ],
    status: 1,
    output: failure(
      "resource_origin_mismatch:0",
      "resource_url_duplicate:6:/read",
      "required_route_missing:/deep-audit",
      "required_route_missing:/extract",
    ),
  },
  {
    name: "missing single payment",
    args: [
      mutate("missing-payment", (value) => {
        value.items[2].accepts = [];
      }),
      expectedBase,
      expectedPayee,
    ],
    status: 1,
    output: failure("payment_single_required:2"),
  },
  {
    name: "payment must be object",
    args: [
      mutate("payment-object", (value) => {
        value.items[3].accepts = [null];
      }),
      expectedBase,
      expectedPayee,
    ],
    status: 1,
    output: failure("payment_object_required:3"),
  },
  {
    name: "valid SameDayDesk manifest",
    args: [validPath, expectedBase, expectedPayee],
    status: 0,
    output: {
      ready: true,
      x402_version: 2,
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      pay_to: expectedPayee,
      item_count: 7,
      routes: requiredRoutes,
      manifest_sha256: createHash("sha256").update(validBytes).digest("hex"),
    },
  },
];

try {
  for (const testCase of cases) {
    const result = spawnSync(process.execPath, [checker, ...testCase.args], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.error) {
      throw new Error(`${testCase.name}: ${result.error.message}`);
    }
    if (result.status !== testCase.status) {
      throw new Error(
        `${testCase.name}: expected exit ${testCase.status}, received ${result.status}; stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`,
      );
    }
    if (result.stderr !== "") {
      throw new Error(`${testCase.name}: stderr must be empty: ${JSON.stringify(result.stderr)}`);
    }
    const expected = `${JSON.stringify(testCase.output)}\n`;
    if (result.stdout !== expected) {
      throw new Error(
        `${testCase.name}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(result.stdout)}`,
      );
    }
  }
  console.log(`x402_manifest_cli_benchmark=passed cases=${cases.length}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
