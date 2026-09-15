import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

import {
  classifyExtensionResponsesHeader,
  encodeExtensionResponsesHeader,
  getLastExtensionResponseDiagnostic,
  resetExtensionResponseDiagnosticsForTests,
  wrapFacilitatorClientForExtensionResponseDiagnostics,
  unknownExtensionResponseClassification,
} from "./extension-response-diagnostics.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(
  readFileSync(path.join(ROOT, "fixtures/discovery-compatibility/extension-responses.cases.json"), "utf8"),
);
const require = createRequire(path.join(ROOT, "package.json"));
const { HTTPFacilitatorClient } = await import(pathToFileURL(require.resolve("@x402/core/http")).href);

function headerForCase(entry) {
  if (Object.prototype.hasOwnProperty.call(entry, "header")) return entry.header;
  return encodeExtensionResponsesHeader(entry.headerBase64Json);
}

describe("classifyExtensionResponsesHeader", () => {
  it("distinguishes absent, empty, malformed, and decoded states from fixtures", () => {
    for (const entry of CASES.cases) {
      const classified = classifyExtensionResponsesHeader(headerForCase(entry));
      assert.equal(classified.headerState, entry.headerState, entry.id);
      assert.equal(classified.bazaarStatus, entry.bazaarStatus, entry.id);
      assert.equal(classified.decoded, entry.decoded, entry.id);
      if (entry.bazaarRejectedReasonPresent) {
        assert.equal(classified.bazaarRejectedReasonPresent, true, entry.id);
        assert.equal(classified.rejectedReasonPreview, "info failed schema validation");
      }
      const json = JSON.stringify(classified);
      assert.equal(json.includes("signature"), false, entry.id);
      assert.equal(json.includes("0x"), false, entry.id);
    }
  });

  it("does not treat decoded {} as absent or empty", () => {
    const absent = classifyExtensionResponsesHeader(null);
    const empty = classifyExtensionResponsesHeader("");
    const decodedEmpty = classifyExtensionResponsesHeader(encodeExtensionResponsesHeader({}));
    assert.equal(absent.headerState, "absent");
    assert.equal(empty.headerState, "empty");
    assert.equal(decodedEmpty.headerState, "decoded");
    assert.equal(decodedEmpty.bazaarStatus, "unknown");
    assert.notEqual(absent.headerState, decodedEmpty.headerState);
    assert.notEqual(empty.headerState, decodedEmpty.headerState);
  });

  it("keeps missing telemetry unknown", () => {
    resetExtensionResponseDiagnosticsForTests();
    const last = getLastExtensionResponseDiagnostic();
    assert.equal(last.phase, null);
    assert.deepEqual(last.verify, unknownExtensionResponseClassification());
    assert.equal(last.verify.headerState, "unknown");
    assert.equal(last.settle.headerState, "unknown");
  });
});

describe("wrapFacilitatorClientForExtensionResponseDiagnostics", () => {
  it("classifies success, empty, absent, and malformed headers through HTTPFacilitatorClient", async () => {
    resetExtensionResponseDiagnosticsForTests();
    const modes = ["success", "empty", "absent", "malformed"];
    let modeIndex = 0;
    const server = createHttpServer((req, res) => {
      if (req.method === "GET" && req.url === "/supported") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ kinds: [{ network: "eip155:8453", scheme: "exact", x402Version: 2 }], extensions: [], signers: {} }));
        return;
      }
      const mode = modes[Math.min(modeIndex, modes.length - 1)];
      const headers = { "content-type": "application/json" };
      if (mode === "success") {
        headers["EXTENSION-RESPONSES"] = encodeExtensionResponsesHeader({ bazaar: { status: "success" } });
      } else if (mode === "empty") {
        headers["EXTENSION-RESPONSES"] = "";
      } else if (mode === "malformed") {
        headers["EXTENSION-RESPONSES"] = "%%%not-base64%%%";
      }
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        assert.equal(body.includes("signature"), true);
        res.writeHead(200, headers);
        if (req.url === "/verify") {
          res.end(JSON.stringify({ isValid: true, payer: "0x0000000000000000000000000000000000000001" }));
        } else {
          res.end(JSON.stringify({
            success: true,
            payer: "0x0000000000000000000000000000000000000001",
            transaction: `0x${"a".repeat(64)}`,
            network: "eip155:8453",
          }));
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      const wrapped = wrapFacilitatorClientForExtensionResponseDiagnostics(new HTTPFacilitatorClient({ url }));
      const paymentPayload = {
        x402Version: 2,
        accepted: { scheme: "exact", network: "eip155:8453", amount: "10000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0x8904dF3DE6DFEe6a7C8cc38619d2f17806213Cee" },
        payload: { stub: true, signature: "0xstub" },
        resource: { url: "https://agents.samedaydesk.com/work/opportunity-preflight" },
        extensions: { bazaar: { info: { input: { type: "http", method: "GET" } }, schema: { type: "object" } } },
      };
      const observed = [];
      for (const expected of [
        { headerState: "decoded", bazaarStatus: "success" },
        { headerState: "empty", bazaarStatus: "unknown" },
        { headerState: "absent", bazaarStatus: "unknown" },
        { headerState: "malformed", bazaarStatus: "unknown" },
      ]) {
        await wrapped.verify(paymentPayload, paymentPayload.accepted);
        const diagnostic = getLastExtensionResponseDiagnostic();
        assert.equal(diagnostic.verify.headerState, expected.headerState);
        assert.equal(diagnostic.verify.bazaarStatus, expected.bazaarStatus);
        observed.push(diagnostic.verify.headerState);
        modeIndex += 1;
      }
      assert.deepEqual(observed, ["decoded", "empty", "absent", "malformed"]);
      const dumped = JSON.stringify(getLastExtensionResponseDiagnostic());
      assert.equal(dumped.includes("0xstub"), false);
      assert.equal(dumped.includes("payload"), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
