// Test-only boundary, loaded before the merchant and inherited by its children.
// Public URLs are either explicitly mapped to a loopback fixture or refused.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { Socket } from "node:net";
import path from "node:path";

const realFetch = globalThis.fetch;
const fixture = process.env.RECOVERY_FIXTURE_URL;
if (process.env.RECOVERY_CLOCK_MS) {
  const OriginalDate = Date;
  const fixed = Number(process.env.RECOVERY_CLOCK_MS);
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
}
let events = [];
let armed = false;
const note = (kind, detail) => { if (armed) events.push({ kind, detail }); };
if (process.env.RECOVERY_PROBE_ENABLED === "1") process.on("message", async message => {
  if (message?.probe === "reset") { events = []; armed = true; }
  if (message?.probe === "calibrate") {
    const target = path.join(process.env.COMMERCE_DATA_DIR, "write-probe.fixture");
    await fsp.writeFile(target, "synthetic write-probe\n");
    await fsp.unlink(target);
    await globalThis.fetch(`${fixture}/supported`);
  }
  if (["reset", "snapshot", "calibrate"].includes(message?.probe)) {
    process.send?.({ probe: message.probe, events });
  }
});

// Also close native http/https socket paths, before DNS or transport can occur.
const connect = Socket.prototype.connect;
Socket.prototype.connect = function (...args) {
  const target = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = target && typeof target === "object" ? target.host : typeof args[1] === "string" ? args[1] : null;
  if (host && !["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    note("external_socket", host);
    throw new Error("independent_recovery_external_socket_refused");
  }
  return connect.apply(this, args);
};

const catalogHosts = new Set([
  "api.cdp.coinbase.com", "agent402.tools", "api.circle.com", "api.agentic.market",
  "agentictrade.io", "mpp.dev", "www.mppscan.com", "payanagent.com",
  "api.x402.jobs", "api.8004market.io", "8004market.io",
]);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  note("fetch", { url: url.href, method: init?.method || "GET" });
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return realFetch(input, init);
  if (fixture && url.origin === "https://facilitator.xpay.sh" && url.pathname === "/supported") {
    return realFetch(`${fixture}/supported`, { ...init, redirect: "error" });
  }
  if (fixture && url.origin === "https://vibes-coded.com") {
    return realFetch(`${fixture}${url.pathname}`, { ...init, redirect: "error" });
  }
  if (fixture && catalogHosts.has(url.hostname) && (!init?.method || init.method === "GET")) {
    return realFetch(`${fixture}/catalog`, { ...init, redirect: "error" });
  }
  throw new Error("independent_recovery_external_network_refused");
};

// Count attempts, including failures and writes through already-open handles.
for (const name of ["appendFile", "writeFile", "rename", "mkdir", "unlink", "rm", "chmod", "truncate"]) {
  for (const target of [fs, fsp]) {
    const original = target[name];
    target[name] = function (...args) { note("write", name); return original.apply(this, args); };
  }
  const sync = `${name}Sync`;
  if (fs[sync]) {
    const original = fs[sync];
    fs[sync] = function (...args) { note("write", sync); return original.apply(this, args); };
  }
}
const writable = flags => typeof flags === "number"
  ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC))
  : /[wa+]/.test(String(flags));
const originalOpen = fsp.open;
fsp.open = async function (...args) {
  if (writable(args[1])) note("write", "open");
  const handle = await originalOpen.apply(this, args);
  for (const name of ["appendFile", "writeFile", "write", "writev", "truncate"]) {
    const original = handle[name];
    handle[name] = function (...values) { note("write", `handle.${name}`); return original.apply(this, values); };
  }
  return handle;
};
for (const name of ["open", "openSync"]) {
  const original = fs[name];
  fs[name] = function (...args) {
    if (writable(args[1])) note("write", name);
    return original.apply(this, args);
  };
}
for (const name of ["write", "writeSync", "writev", "writevSync", "createWriteStream"]) {
  const original = fs[name];
  fs[name] = function (...args) { note("write", name); return original.apply(this, args); };
}
syncBuiltinESMExports();
