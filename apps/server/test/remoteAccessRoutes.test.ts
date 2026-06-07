import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { AppDatabase } from "../src/db.js";
import { registerRemoteAccessRoutes } from "../src/routes/remoteAccessRoutes.js";
import { registerApiAuth } from "../src/services/authService.js";
import { readPersistedRemoteAccessConfig, RemoteAccessService, remoteAccessAuthToken } from "../src/services/remoteAccessService.js";
import type { ServerRuntimeConfig } from "../src/services/serverConfig.js";

test("remote access routes persist enablement, generate token, rotate, and clear", async (t) => {
  const { db, cleanup } = await createDb(t);
  const service = new RemoteAccessService(db, config({ authRequired: false, host: "127.0.0.1" }), {
    isWslEnvironment: () => false,
    listLanCandidateUrls: ({ port, selectedHost }) => [{ host: selectedHost ?? "192.168.1.25", url: `http://${selectedHost ?? "192.168.1.25"}:${port}/`, interfaceName: "Wi-Fi", source: "server-interface", recommended: true }],
  });
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  const initial = await fastify.inject({ method: "GET", url: "/api/remote-access/status" });
  assert.equal(initial.statusCode, 200);
  assert.equal((initial.json() as { enabled?: unknown }).enabled, false);

  const enabled = await fastify.inject({ method: "POST", url: "/api/remote-access", payload: { enabled: true, selectedHost: "192.168.1.25" } });
  assert.equal(enabled.statusCode, 200);
  const enabledBody = enabled.json() as { status: { enabled: boolean; restartRequired: boolean; selectedUrl?: string }; pairing?: { token: string; pairingUrl: string } };
  assert.equal(enabledBody.status.enabled, true);
  assert.equal(enabledBody.status.restartRequired, true);
  assert.equal(enabledBody.status.selectedUrl, "http://192.168.1.25:8787/");
  assert.ok(enabledBody.pairing?.token);
  assert.match(enabledBody.pairing?.pairingUrl ?? "", /^http:\/\/192\.168\.1\.25:8787\/#token=/);
  assert.equal(readPersistedRemoteAccessConfig(db).enabled, true);
  assert.equal(readPersistedRemoteAccessConfig(db).authToken, enabledBody.pairing?.token);

  const rotated = await fastify.inject({ method: "POST", url: "/api/remote-access", payload: { rotateToken: true } });
  const rotatedBody = rotated.json() as { pairing?: { token: string } };
  assert.notEqual(rotatedBody.pairing?.token, enabledBody.pairing?.token);

  const cleared = await fastify.inject({ method: "POST", url: "/api/remote-access", payload: { clearToken: true } });
  assert.equal(cleared.statusCode, 200);
  assert.deepEqual(readPersistedRemoteAccessConfig(db), { enabled: false, authToken: undefined });

  await cleanup();
});

test("remote access env token source keeps pairing token stable when rotate is requested", async (t) => {
  const { db, cleanup } = await createDb(t);
  const service = new RemoteAccessService(db, config({ authRequired: true, host: "0.0.0.0", remoteLan: true, authToken: "env-token", authTokenSource: "env" }), {
    isWslEnvironment: () => false,
    listLanCandidateUrls: () => [{ host: "192.168.1.25", url: "http://192.168.1.25:8787/", interfaceName: "Wi-Fi", source: "server-interface", recommended: true }],
  });
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/remote-access", payload: { rotateToken: true } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { pairing?: { token: string; pairingUrl: string } };
  assert.equal(body.pairing?.token, "env-token");
  assert.match(body.pairing?.pairingUrl ?? "", /^http:\/\/192\.168\.1\.25:8787\/#token=env-token/);
  assert.equal(db.getSettingValue("remoteAccess.token"), undefined);

  await cleanup();
});

test("remote access routes are protected when auth provider requires a token", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.token", "server-token");
  const serverConfig = config({ authRequired: true, host: "0.0.0.0", remoteLan: true, authToken: "server-token", authTokenSource: "persisted" });
  const service = new RemoteAccessService(db, serverConfig);
  const fastify = Fastify({ logger: false });
  registerApiAuth(fastify, {
    authRequired: () => true,
    getAuthToken: () => remoteAccessAuthToken(db, serverConfig),
  });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  assert.equal((await fastify.inject({ method: "GET", url: "/api/remote-access/status" })).statusCode, 401);
  assert.equal((await fastify.inject({ method: "GET", url: "/api/remote-access/status", headers: { authorization: "Bearer server-token" } })).statusCode, 200);

  await cleanup();
});

test("remote access route can launch WSL Windows portproxy setup", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.enabled", "true");
  db.setSettingValue("remoteAccess.token", "setup-token");
  const launched: Array<{ listenPort: number; connectAddress: string }> = [];
  const service = new RemoteAccessService(db, config({ authRequired: true, host: "0.0.0.0", remoteLan: true, port: 8787 }), {
    isWslEnvironment: () => true,
    listLanCandidateUrls: () => [
      { host: "192.168.1.44", url: "http://192.168.1.44:8787/", interfaceName: "Wi-Fi", source: "windows-host", requiresPortProxy: true, recommended: true },
      { host: "172.20.253.149", url: "http://172.20.253.149:8787/", interfaceName: "eth0", source: "server-interface" },
    ],
    launchWindowsPortProxySetup: async (request) => { launched.push(request); },
  });
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  const denied = await fastify.inject({ method: "POST", url: "/api/remote-access/windows-portproxy" });
  assert.equal(denied.statusCode, 401);
  assert.deepEqual(launched, []);

  const response = await fastify.inject({ method: "POST", url: "/api/remote-access/windows-portproxy", headers: { authorization: "Bearer setup-token" } });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { accepted: boolean; targetHost: string; listenPort: number; requiresAdmin: boolean; message: string };
  assert.equal(body.accepted, true);
  assert.equal(body.targetHost, "172.20.253.149");
  assert.equal(body.listenPort, 8787);
  assert.equal(body.requiresAdmin, true);
  assert.match(body.message, /192\.168\.1\.44:8787/);
  assert.deepEqual(launched, [{ listenPort: 8787, connectAddress: "172.20.253.149" }]);

  await cleanup();
});

test("remote access Windows portproxy setup requires active LAN listening", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.enabled", "true");
  db.setSettingValue("remoteAccess.token", "setup-token");
  const service = new RemoteAccessService(db, config({ authRequired: false, host: "127.0.0.1", port: 8787 }), {
    isWslEnvironment: () => true,
    listLanCandidateUrls: () => [
      { host: "172.20.253.149", url: "http://172.20.253.149:8787/", interfaceName: "eth0", source: "server-interface", recommended: true },
    ],
  });
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/remote-access/windows-portproxy", headers: { authorization: "Bearer setup-token" } });
  assert.equal(response.statusCode, 500);
  assert.match(response.json().message, /先重启 Pi GUI 服务/);

  await cleanup();
});

// Clearing a persisted remote token must invalidate saved Android tokens immediately in the
// current server process; do not fall back to the startup-captured config token.
test("remote access clear invalidates a persisted token without restart", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.enabled", "true");
  db.setSettingValue("remoteAccess.token", "old-token");
  const serverConfig = config({ authRequired: true, host: "0.0.0.0", remoteLan: true, authToken: "old-token", authTokenSource: "persisted" });
  const service = new RemoteAccessService(db, serverConfig);
  const fastify = Fastify({ logger: false });
  registerApiAuth(fastify, {
    authRequired: () => true,
    getAuthToken: () => remoteAccessAuthToken(db, serverConfig),
  });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  assert.equal((await fastify.inject({ method: "GET", url: "/api/remote-access/status", headers: { authorization: "Bearer old-token" } })).statusCode, 200);
  assert.equal((await fastify.inject({ method: "POST", url: "/api/remote-access", headers: { authorization: "Bearer old-token" }, payload: { clearToken: true } })).statusCode, 200);
  assert.equal((await fastify.inject({ method: "GET", url: "/api/remote-access/status", headers: { authorization: "Bearer old-token" } })).statusCode, 401);

  await cleanup();
});

test("remote access pairing URL prefers Windows host URL in WSL even if old WSL host is selected", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.enabled", "true");
  db.setSettingValue("remoteAccess.selectedHost", "172.20.253.149");
  const service = new RemoteAccessService(db, config({ authRequired: true, host: "0.0.0.0", remoteLan: true, port: 8787, authToken: "phone-token", authTokenSource: "persisted" }), {
    isWslEnvironment: () => true,
    listLanCandidateUrls: () => [
      { host: "192.168.1.44", url: "http://192.168.1.44:8787/", interfaceName: "Wi-Fi", source: "windows-host", requiresPortProxy: true, recommended: true },
      { host: "172.20.253.149", url: "http://172.20.253.149:8787/", interfaceName: "eth0", source: "server-interface" },
    ],
  });
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "GET", url: "/api/remote-access/pairing" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { pairingUrl: string; status: { selectedUrl?: string; recommendedUrl?: string } };
  assert.equal(body.status.selectedUrl, "http://172.20.253.149:8787/");
  assert.equal(body.status.recommendedUrl, "http://192.168.1.44:8787/");
  assert.match(body.pairingUrl, /^http:\/\/192\.168\.1\.44:8787\/#token=/);

  await cleanup();
});

test("remote access pairing URL avoids WSL NAT when Windows host IP is unavailable", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.enabled", "true");
  const service = new RemoteAccessService(db, config({ authRequired: true, host: "0.0.0.0", remoteLan: true, port: 8787, authToken: "phone-token", authTokenSource: "persisted" }), {
    isWslEnvironment: () => true,
    listLanCandidateUrls: () => [
      { host: "172.20.253.149", url: "http://172.20.253.149:8787/", interfaceName: "eth0", source: "server-interface", recommended: true },
    ],
  });
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service);
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "GET", url: "/api/remote-access/pairing" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { pairingUrl: string };
  assert.match(body.pairingUrl, /^http:\/\/127\.0\.0\.1:8787\/#token=/);
  assert.doesNotMatch(body.pairingUrl, /172\.20\.253\.149/);

  await cleanup();
});

test("remote access restart route acknowledges then schedules server restart", async (t) => {
  const { db, cleanup } = await createDb(t);
  db.setSettingValue("remoteAccess.enabled", "true");
  const service = new RemoteAccessService(db, config({ authRequired: false, host: "127.0.0.1" }));
  let restartCount = 0;
  const fastify = Fastify({ logger: false });
  await registerRemoteAccessRoutes(fastify, service, {
    restartDelayMs: 0,
    restartServer: () => {
      restartCount += 1;
    },
  });
  t.after(() => fastify.close());

  const response = await fastify.inject({ method: "POST", url: "/api/remote-access/restart" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { accepted?: boolean; reconnectDelayMs?: number; status?: { restartRequired?: boolean } };
  assert.equal(body.accepted, true);
  assert.equal(body.status?.restartRequired, true);
  assert.equal(typeof body.reconnectDelayMs, "number");

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(restartCount, 1);

  await cleanup();
});

async function createDb(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(join(tmpdir(), "pi-gui-remote-access-test-"));
  const db = new AppDatabase(join(dir, "db.sqlite"));
  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
  t.after(() => cleanup());
  return { db, cleanup };
}

function config(overrides: Partial<ServerRuntimeConfig> = {}): ServerRuntimeConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    mode: "development",
    authRequired: false,
    remoteLan: false,
    ...overrides,
  };
}
