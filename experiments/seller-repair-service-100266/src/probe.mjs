import { createHash } from "node:crypto";
import http from "node:http";
import https from "node:https";

import { PRIVATE_MARKER } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { collectPaths, pathValue } from "./paths.mjs";

const WALLET = /0x[0-9a-fA-F]{40}/;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function loopback(url) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

export function containsPrivateMarker(buffer) {
  const text = buffer.toString("utf8");
  return text.includes(PRIVATE_MARKER) || text.includes("sk_live_") || WALLET.test(text);
}

export async function probeOnce({
  baseUrl,
  method = "GET",
  route,
  deadlineMs,
  bodyBytes,
  fixtureMode = null,
  headerImpl = null,
}) {
  if (typeof baseUrl !== "string" || typeof route !== "string" || !route.startsWith("/")) {
    fail("probe target is incomplete");
  }
  const url = new URL(route, baseUrl);
  if (url.username || url.password || url.hash) fail("probe URL must not carry credentials");
  const transport = url.protocol === "https:" ? https : http;
  if (url.protocol !== "http:" && url.protocol !== "https:") fail("probe URL scheme is not supported");
  const headers = { accept: "application/json" };
  if (fixtureMode && loopback(url)) headers["x-fixture-mode"] = fixtureMode;
  if (headerImpl) Object.assign(headers, headerImpl);

  return await new Promise((resolve, reject) => {
    let settled = false;
    let deadlineTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      resolve(result);
    };
    const request = transport.request(url, { method, headers, timeout: deadlineMs }, (response) => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.destroy();
        finish({
          route,
          method,
          status,
          redirectUnfollowed: true,
          bodyDeadline: false,
          privateSentinel: false,
          bodyRetained: false,
          json: false,
          byteLength: 0,
          digest: null,
          paths: [],
          values: {},
          contentType: String(response.headers["content-type"] || ""),
          paymentSent: false,
        });
        return;
      }
      const chunks = [];
      let total = 0;
      let discarded = false;
      const empty = (extra) => finish({
        route,
        method,
        status,
        redirectUnfollowed: false,
        bodyDeadline: false,
        privateSentinel: false,
        bodyRetained: false,
        json: false,
        byteLength: 0,
        digest: null,
        paths: [],
        values: {},
        contentType: String(response.headers["content-type"] || ""),
        paymentSent: false,
        ...extra,
      });
      response.on("data", (chunk) => {
        if (discarded) return;
        total += chunk.length;
        if (total > bodyBytes) {
          discarded = true;
          chunks.length = 0;
          response.destroy();
          empty({ bodyDeadline: false, reason: "body_ceiling" });
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (discarded) return;
        const body = Buffer.concat(chunks);
        if (containsPrivateMarker(body)) {
          empty({ privateSentinel: true, byteLength: body.length });
          return;
        }
        let parsed = null;
        let json = false;
        const type = String(response.headers["content-type"] || "");
        if (type.includes("application/json") || (body.length && body[0] === 0x7b)) {
          try {
            parsed = JSON.parse(body.toString("utf8"));
            json = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
          } catch {
            json = false;
          }
        }
        const paths = json ? collectPaths(parsed) : [];
        const values = {};
        for (const path of paths) values[path] = pathValue(parsed, path);
        finish({
          route,
          method,
          status,
          redirectUnfollowed: false,
          bodyDeadline: false,
          privateSentinel: false,
          bodyRetained: true,
          json,
          byteLength: body.length,
          digest: sha256(body),
          paths,
          values,
          contentType: type,
          paymentSent: false,
          body: json ? parsed : null,
        });
      });
      response.on("error", () => {
        empty({ bodyDeadline: true, reason: "body_deadline" });
      });
    });
    const deadline = () => {
      request.destroy();
      finish({
        route,
        method,
        status: null,
        redirectUnfollowed: false,
        bodyDeadline: true,
        privateSentinel: false,
        bodyRetained: false,
        json: false,
        byteLength: 0,
        digest: null,
        paths: [],
        values: {},
        contentType: "",
        paymentSent: false,
        reason: "body_deadline",
      });
    };
    deadlineTimer = setTimeout(deadline, deadlineMs);
    request.on("timeout", deadline);
    request.on("error", (error) => {
      if (settled) return;
      if (error?.code === "ECONNRESET" || String(error?.message || "").includes("socket")) {
        finish({
          route,
          method,
          status: null,
          redirectUnfollowed: false,
          bodyDeadline: true,
          privateSentinel: false,
          bodyRetained: false,
          json: false,
          byteLength: 0,
          digest: null,
          paths: [],
          values: {},
          contentType: "",
          paymentSent: false,
          reason: "body_deadline",
        });
        return;
      }
      settled = true;
      clearTimeout(deadlineTimer);
      reject(error);
    });
    request.end();
  });
}

export async function probeDeclarationAndResource({ baseUrl, intake, fixtureMode = null }) {
  const calls = [];
  let document = null;
  let documentProbe = null;
  if (intake.maxEffort.probes >= 2) {
    documentProbe = await probeOnce({
      baseUrl,
      method: "GET",
      route: "/openapi.json",
      deadlineMs: intake.maxEffort.deadlineMs,
      bodyBytes: intake.maxEffort.bodyBytes,
      fixtureMode,
    });
    calls.push(summarize(documentProbe));
    if (documentProbe.json && documentProbe.body) document = documentProbe.body;
  }
  if (calls.length >= intake.maxEffort.probes) {
    return { document, documentProbe, resourceProbe: null, calls, paymentSent: false };
  }
  const resourceProbe = await probeOnce({
    baseUrl,
    method: intake.method,
    route: intake.resource,
    deadlineMs: intake.maxEffort.deadlineMs,
    bodyBytes: intake.maxEffort.bodyBytes,
    fixtureMode,
  });
  calls.push(summarize(resourceProbe));
  return { document, documentProbe, resourceProbe, calls, paymentSent: false };
}

export function summarize(probe) {
  if (!probe) return null;
  return {
    route: probe.route,
    method: probe.method,
    status: probe.status,
    byteLength: probe.byteLength,
    digest: probe.digest,
    redirectUnfollowed: probe.redirectUnfollowed === true,
    bodyDeadline: probe.bodyDeadline === true,
    privateSentinel: probe.privateSentinel === true,
    bodyRetained: probe.bodyRetained === true,
    json: probe.json === true,
    paths: probe.paths || [],
    paymentSent: false,
  };
}

export function publicObservation(probe) {
  if (!probe) return null;
  const { body, values, ...rest } = probe;
  return {
    ...rest,
    values: probe.privateSentinel ? {} : values,
    body: probe.privateSentinel ? null : body,
    http200IsSuccess: false,
    paymentSent: false,
  };
}
