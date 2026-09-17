#!/usr/bin/env node

import { classifyHttpExchange } from "./unpaid-402.mjs";

const DEFAULT_URL = "https://agents.samedaydesk.com/extract?url=https%3A%2F%2Fexample.com";

function headerObject(headers) {
  const object = {};
  for (const [name, value] of headers.entries()) object[name.toLowerCase()] = value;
  return object;
}

async function probe(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/json",
      "user-agent": "x402-protocol-fixtures/unpaid-402-probe",
    },
  });
  const responseHeaders = headerObject(response.headers);
  let body;
  const text = await response.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  const result = classifyHttpExchange({
    method: "GET",
    url,
    requestHeaders: { accept: "application/json" },
    status: response.status,
    responseHeaders,
    body,
  });
  return {
    url,
    httpStatus: response.status,
    paymentRequiredPresent: Boolean(responseHeaders["payment-required"]),
    paymentResponsePresent: Boolean(responseHeaders["payment-response"]),
    paymentSignaturePresent: Boolean(responseHeaders["payment-signature"]),
    credentialsUsed: false,
    paymentSent: false,
    ...result,
  };
}

const url = process.argv[2] || DEFAULT_URL;
const report = await probe(url);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok && report.verdict === "unpaid_402" ? 0 : 1);
