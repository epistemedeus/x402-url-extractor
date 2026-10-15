import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

function envPath(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") return "";
  return value.trim();
}

const missingHarnessEnv = ["AE20_NEO_DIR", "AE20_GATEWAY_NODE_MODULES"].filter((name) => envPath(name) === "");
if (missingHarnessEnv.length > 0) {
  const listed = missingHarnessEnv.join(" and ");
  const verb = missingHarnessEnv.length === 1 ? "is" : "are";
  throw new Error(
    `${listed} ${verb} unset. Set ${listed} to absolute paths before loading the AE20 gateway harness. There is no /tmp or /home/ubuntu fallback.`,
  );
}

export const GATEWAY_667 = "667fba353e9082d8a0842437442dabc42843abf8";
export const GATEWAY_7E = "7e5078bbf213ae3d1ff8d4638199ff8d1d1d81a8";
export const ASYNC_PIN = "1b5fd425408d34be232cd1c2ce059d3571b56c63";
export const NEO = envPath("AE20_NEO_DIR");
export const AJV_MODULES = envPath("AE20_GATEWAY_NODE_MODULES");
export const TOKEN = "local_unsigned_tenant_a_credential_000001";

async function assertGatewayModules() {
  let info;
  try {
    info = await stat(AJV_MODULES);
  } catch {
    throw new Error(
      `AE20_GATEWAY_NODE_MODULES is not a directory (${AJV_MODULES}). Set it to the machine-gateway node_modules path. There is no /tmp fallback.`,
    );
  }
  if (!info.isDirectory()) {
    throw new Error(`AE20_GATEWAY_NODE_MODULES is not a directory (${AJV_MODULES}).`);
  }
}

async function installGatewayLockfile(gateway) {
  const shrinkwrap = join(gateway, "npm-shrinkwrap.json");
  const lockfile = join(gateway, "package-lock.json");
  if (!existsSync(shrinkwrap) && !existsSync(lockfile)) {
    throw new Error(
      `Gateway copy ${gateway} has no npm-shrinkwrap.json or package-lock.json, so npm ci cannot install it.`,
    );
  }
  await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: gateway,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export async function materializeGateway(pin, { patchFile = null } = {}) {
  await assertGatewayModules();
  const root = await mkdtemp(join(tmpdir(), "ae20-x1-gw-"));
  try {
    await exec("bash", ["-c", "git -C \"$1\" archive \"$2\" services/machine-gateway | tar -C \"$3\" -x", "bash", NEO, pin, root]);
    const gateway = join(root, "services/machine-gateway");
    if (patchFile) {
      await exec("patch", ["-p1", "--forward", "--batch", `--input=${patchFile}`], { cwd: gateway });
    }
    await installGatewayLockfile(gateway);
    return { root, gateway };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export async function listenGateway(t, gatewayDir, binding) {
  const src = join(gatewayDir, "src");
  const gatewayMod = await import(pathToFileURL(join(src, "index.mjs")).href);
  const { sha256 } = await import(pathToFileURL(join(src, "util.mjs")).href);
  const routes = await import(pathToFileURL(join(src, "url-extract-routes.mjs")).href);
  routes.bindUrlExtractService(binding);
  const dir = await mkdtemp(join(tmpdir(), "ae20-x1-state-"));
  const store = new gatewayMod.SqliteStore(join(dir, "machine-gateway.sqlite"));
  const registry = new gatewayMod.RouteRegistry(gatewayMod.builtinRoutes());
  const gateway = new gatewayMod.MachineGateway({
    store,
    registry,
    tenants: [{
      id: binding.tenantId,
      tokenSha256: sha256(TOKEN),
      routes: registry.list().map((route) => route.id),
      maxUnits: 100,
      maxCalls: 1000,
      maxConcurrent: 4,
    }],
    environment: "test",
    paymentsEnabled: false,
  });
  const server = gatewayMod.createGatewayServer(gateway);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    routes.unbindUrlExtractService();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  let n = 0;
  async function call(path, { body, key } = {}) {
    const response = await fetch(`${origin}${gateway.prefix}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
    return { status: response.status, replay: response.headers.get("idempotency-replayed"), body: parsed };
  }
  async function quote(routeId, input) {
    return call("/v1/quote", { body: { routeId, input } });
  }
  async function execute(routeId, input, key = `ae20x1exec${String(++n).padStart(8, "0")}`) {
    const quoted = await quote(routeId, input);
    if (quoted.status !== 200) return { ...quoted, quote: quoted.body };
    const ran = await call("/v1/execute", {
      body: { quoteId: quoted.body.quoteId, input, maxUnits: 0 },
      key,
    });
    return { ...ran, quote: quoted.body, input };
  }
  async function testRoute(routeId) {
    return call("/v1/test", { body: { routeId } });
  }
  return { call, quote, execute, testRoute, origin, prefix: gateway.prefix };
}
