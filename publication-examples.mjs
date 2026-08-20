import {
  isSafePublicationInputName,
  isSensitiveInputName,
  scalarNonEmpty,
} from "./discovery-contract.mjs";

function fail(message) {
  throw new Error(`Publication example invalid: ${message}`);
}

function assertHttpsExample(urlString, label) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    fail(`${label} is not a URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail(`${label} must be credential-free HTTPS without a fragment`);
  }
  return url;
}

function walkKeys(value, visit, path = "$") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkKeys(entry, visit, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, `${path}.${key}`);
    walkKeys(child, visit, `${path}.${key}`);
  }
}

export function assertNoSensitivePublicationKeys(value, label) {
  walkKeys(value, (key, path) => {
    if (isSensitiveInputName(key) && !isSafePublicationInputName(key)) {
      fail(`${label} publishes sensitive key ${path}`);
    }
  });
}

export function requiredQueryKeys(request) {
  const required = request?.schema?.properties?.queryParams?.required;
  return Array.isArray(required) ? required.map(String) : [];
}

export function compactJsonExample(value) {
  return JSON.stringify(value);
}

export function callableGetExample(action) {
  const method = String(action?.method || "GET").toUpperCase();
  const route = String(action?.route || "");
  if (method !== "GET") fail(`${method} ${route} is not a GET publication example`);
  const request = action?.request;
  if (!request || request.method !== "GET") fail(`GET ${route} lacks its canonical request contract`);
  if (typeof request.exampleUrl !== "string") fail(`GET ${route} lacks a callable example URL`);
  const url = assertHttpsExample(request.exampleUrl, `GET ${route} exampleUrl`);
  if (url.pathname !== route) fail(`GET ${route} exampleUrl path drifted`);
  const required = requiredQueryKeys(request);
  if (required.length === 0) fail(`GET ${route} has no required query keys to publish`);
  for (const name of required) {
    if (!isSafePublicationInputName(name)) fail(`GET ${route} required key ${name} is not safe to publish`);
    if (!scalarNonEmpty(url.searchParams.get(name))) {
      fail(`GET ${route} callable example is missing required query ${name}`);
    }
  }
  for (const name of url.searchParams.keys()) {
    if (!isSafePublicationInputName(name)) fail(`GET ${route} publishes unsafe query ${name}`);
  }
  assertNoSensitivePublicationKeys(request.example?.queryParams || {}, `GET ${route} query example`);
  if (url.search.length < 2) fail(`GET ${route} exampleUrl has no query string`);
  return {
    method: "GET",
    route,
    exampleUrl: request.exampleUrl,
    requiredKeys: required,
    transmissible: true,
  };
}

export function postSchemaBodyExample(action) {
  const method = String(action?.method || "").toUpperCase();
  const route = String(action?.route || "");
  if (method !== "POST") fail(`${method} ${route} is not a POST publication example`);
  const request = action?.request;
  if (!request || request.method !== "POST" || !request.schema) {
    fail(`POST ${route} lacks its canonical request contract`);
  }
  if (request.exampleUrl) fail(`POST ${route} must not publish a transmissible example URL`);
  if (request.example?.bodyType !== "json" || !request.example.body || typeof request.example.body !== "object" || Array.isArray(request.example.body)) {
    fail(`POST ${route} lacks a JSON body example`);
  }
  assertNoSensitivePublicationKeys(request.example.body, `POST ${route} body example`);
  const required = Array.isArray(request.schema?.properties?.body?.required)
    ? request.schema.properties.body.required.map(String)
    : [];
  for (const name of required) {
    if (!isSafePublicationInputName(name)) fail(`POST ${route} required body key ${name} is not safe to publish`);
    if (!Object.hasOwn(request.example.body, name)) fail(`POST ${route} body example is missing required ${name}`);
  }
  return {
    method: "POST",
    route,
    body: request.example.body,
    bodyJson: compactJsonExample(request.example.body),
    transmissible: false,
  };
}

export function formatSkillActionLine(action) {
  const method = String(action?.method || "").toUpperCase();
  const route = String(action?.route || "");
  const priceUsdc = Number(action?.priceUsdc);
  const protocols = Array.isArray(action?.paymentProtocols)
    ? action.paymentProtocols.map((protocol) => String(protocol)).join(" + ")
    : "";
  if (!/^[A-Z]+$/.test(method) || !route.startsWith("/") || !Number.isFinite(priceUsdc) || priceUsdc <= 0 || !protocols) {
    throw new TypeError(`invalid action contract: ${method} ${route}`);
  }
  if (method === "GET") {
    const example = callableGetExample(action);
    return `- GET ${route}: ${priceUsdc} USDC through ${protocols}. Example: ${example.exampleUrl}`;
  }
  if (method === "POST") {
    const example = postSchemaBodyExample(action);
    return `- POST ${route}: ${priceUsdc} USDC through ${protocols}. JSON body example (do not transmit): ${example.bodyJson}`;
  }
  fail(`${method} ${route} uses an unsupported publication method`);
}

export function formatGitHubSkillActionLine(action) {
  const method = String(action?.method || "").toUpperCase();
  const route = String(action?.route || "");
  if (method === "GET") {
    const example = callableGetExample(action);
    return `- GET ${route}. Example: ${example.exampleUrl}`;
  }
  if (method === "POST") {
    const example = postSchemaBodyExample(action);
    return `- POST ${route}. JSON body example (do not transmit): ${example.bodyJson}`;
  }
  fail(`${method} ${route} uses an unsupported publication method`);
}

export function formatGitHubSkillAlternateLine(alternate) {
  if (!alternate?.route) fail("Circle alternate is missing a route");
  const example = callableGetExample({
    method: "GET",
    route: alternate.route,
    request: alternate.request,
  });
  return `- GET ${alternate.route}. Same payment-offer preflight product through Circle Gateway x402 Nanopayments, not a second catalog action. Example: ${example.exampleUrl}`;
}

export function formatSkillAlternateLine(alternate) {
  if (!alternate?.route) fail("Circle alternate is missing a route");
  const example = callableGetExample({
    method: "GET",
    route: alternate.route,
    request: alternate.request,
  });
  const priceUsdc = Number(alternate.priceUsdc ?? (Number(alternate.priceAtomicUsdc) / 1e6));
  const price = Number.isFinite(priceUsdc) && priceUsdc > 0 ? `${priceUsdc} USDC` : "the same quoted USDC amount";
  return `- GET ${alternate.route}: ${price} through Circle Gateway x402 Nanopayments. Same payment-offer preflight product, not a second catalog action. Example: ${example.exampleUrl}`;
}

function documentHasTransmissiblePost(text, route) {
  const escaped = String(route).replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`https://[^\\s)\`'"]+${escaped}\\?`, "i").test(String(text || ""));
}

export function validatePublicationExampleParity({
  actions,
  alternate = null,
  documents,
} = {}) {
  if (!Array.isArray(actions) || actions.length === 0) fail("actions are required");
  if (!documents || typeof documents !== "object") fail("publication documents are required");
  const names = Object.keys(documents);
  if (names.length === 0) fail("publication documents are required");
  let getExamples = 0;
  let postExamples = 0;
  for (const action of actions) {
    const method = String(action.method || "GET").toUpperCase();
    if (method === "GET") {
      const example = callableGetExample(action);
      for (const name of names) {
        const text = String(documents[name] || "");
        if (!text.includes(example.exampleUrl)) {
          fail(`${name} is missing the callable GET example for ${example.route}`);
        }
      }
      getExamples += 1;
    } else if (method === "POST") {
      const example = postSchemaBodyExample(action);
      for (const name of names) {
        const text = String(documents[name] || "");
        if (!text.includes(example.bodyJson)) {
          fail(`${name} is missing the POST body example for ${example.route}`);
        }
        if (documentHasTransmissiblePost(text, example.route)) {
          fail(`${name} publishes a transmissible POST URL for ${example.route}`);
        }
      }
      postExamples += 1;
    } else {
      fail(`${method} ${action.route} uses an unsupported publication method`);
    }
  }
  if (alternate) {
    const example = callableGetExample({
      method: "GET",
      route: alternate.route,
      request: alternate.request,
    });
    for (const name of names) {
      const text = String(documents[name] || "");
      if (!text.includes(example.exampleUrl)) {
        fail(`${name} is missing the Circle alternate callable example`);
      }
      if (!/same (?:payment-offer )?preflight product/i.test(text)) {
        fail(`${name} must label Circle as the same preflight product`);
      }
      if (!/not a second catalog action/i.test(text)) {
        fail(`${name} must say Circle is not a second catalog action`);
      }
    }
  }
  return {
    ok: true,
    getExamples,
    postExamples,
    alternateExamples: alternate ? 1 : 0,
    documentCount: names.length,
  };
}
