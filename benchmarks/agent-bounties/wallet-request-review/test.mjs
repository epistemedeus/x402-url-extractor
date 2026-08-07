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
const checker = join(sourceRoot, "scripts", "render-wallet-request-review.mjs");
const fixtureRoot = join(benchmarkRoot, "fixtures");
const requestPath = join(fixtureRoot, "request-valid.json");
const policyPath = join(fixtureRoot, "policy-valid.json");
const validRequest = JSON.parse(readFileSync(requestPath, "utf8"));
const temporary = mkdtempSync(join(tmpdir(), "sdd-wallet-review-benchmark-"));
const now = "1786125300";

if (!existsSync(checker)) {
  console.error(`missing child implementation: ${checker}`);
  process.exit(1);
}

function mutate(name, change) {
  const request = structuredClone(validRequest);
  const originalPayload = request.params[1];
  const payload = JSON.parse(originalPayload);
  change(request, payload);
  if (
    request.params?.length === 2 &&
    typeof request.params[1] === "string" &&
    request.params[1] === originalPayload
  ) {
    request.params[1] = JSON.stringify(payload);
  }
  const path = join(temporary, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(request, null, 2)}\n`);
  return path;
}

const failure = (...errors) => ({ safe: false, errors });
const cases = [
  {
    name: "missing arguments",
    args: [],
    status: 2,
    output: failure("arguments_required"),
  },
  {
    name: "unreadable request",
    args: [join(fixtureRoot, "absent.json"), policyPath, now],
    status: 2,
    output: failure("request_unreadable"),
  },
  {
    name: "malformed request",
    args: [join(fixtureRoot, "malformed.json"), policyPath, now],
    status: 2,
    output: failure("request_invalid_json"),
  },
  {
    name: "request root must be object",
    args: [join(fixtureRoot, "not-an-object.json"), policyPath, now],
    status: 2,
    output: failure("request_root_object_required"),
  },
  {
    name: "unreadable policy",
    args: [requestPath, join(fixtureRoot, "absent.json"), now],
    status: 2,
    output: failure("policy_unreadable"),
  },
  {
    name: "malformed policy",
    args: [requestPath, join(fixtureRoot, "malformed.json"), now],
    status: 2,
    output: failure("policy_invalid_json"),
  },
  {
    name: "invalid current time",
    args: [requestPath, policyPath, "not-a-time"],
    status: 2,
    output: failure("now_unix_invalid"),
  },
  {
    name: "wrong envelope",
    args: [
      mutate("wrong-envelope", (request) => {
        request.method = "personal_sign";
        request.params = ["wrong"];
      }),
      policyPath,
      now,
    ],
    status: 1,
    output: failure("method_mismatch", "params_invalid"),
  },
  {
    name: "invalid typed-data JSON",
    args: [
      mutate("invalid-payload", (request) => {
        request.params[1] = "{";
      }),
      policyPath,
      now,
    ],
    status: 1,
    output: failure("payload_invalid_json"),
  },
  {
    name: "wrong domain",
    args: [
      mutate("wrong-domain", (_request, payload) => {
        payload.domain.name = "USDC";
        payload.domain.version = "1";
        payload.domain.chainId = 84532;
        payload.domain.verifyingContract = "0x1111111111111111111111111111111111111111";
        payload.primaryType = "Permit";
      }),
      policyPath,
      now,
    ],
    status: 1,
    output: failure(
      "domain_name_mismatch",
      "domain_version_mismatch",
      "chain_id_mismatch",
      "token_mismatch",
      "primary_type_mismatch",
    ),
  },
  {
    name: "unsafe authorization",
    args: [
      mutate("unsafe-authorization", (request, payload) => {
        request.params[0] = "0x1111111111111111111111111111111111111111";
        payload.message.from = "0x2222222222222222222222222222222222222222";
        payload.message.to = "0x3333333333333333333333333333333333333333";
        payload.message.value = "2000000";
        payload.message.validAfter = "1786125400";
        payload.message.validBefore = "1786125500";
        payload.message.nonce = "0x1234";
      }),
      policyPath,
      now,
    ],
    status: 1,
    output: failure(
      "signer_mismatch",
      "from_mismatch",
      "recipient_not_allowed",
      "value_exceeds_cap",
      "authorization_not_active",
      "nonce_invalid",
    ),
  },
  {
    name: "expired excessive window",
    args: [
      mutate("expired-window", (_request, payload) => {
        payload.message.validAfter = "1786121000";
        payload.message.validBefore = "1786125299";
      }),
      policyPath,
      now,
    ],
    status: 1,
    output: failure("authorization_expired", "authorization_window_exceeds_cap"),
  },
  {
    name: "valid wallet request",
    args: [requestPath, policyPath, now],
    status: 0,
    output: {
      safe: true,
      method: "eth_signTypedData_v4",
      primary_type: "TransferWithAuthorization",
      wallet: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee",
      chain_id: 8453,
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      recipient: "0x7b056457d04bcdbb5851112d007168aba30adf49",
      value_base_units: "10000",
      value_usdc: "0.010000",
      valid_after: 1786125000,
      valid_before: 1786125900,
      seconds_remaining: 600,
      nonce: "0x3333333333333333333333333333333333333333333333333333333333333333",
      warnings: [],
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
    if (result.error) throw new Error(`${testCase.name}: ${result.error.message}`);
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
  console.log(`wallet_request_review_benchmark=passed cases=${cases.length}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
