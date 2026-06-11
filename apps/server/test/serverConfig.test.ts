import assert from "node:assert/strict";
import test from "node:test";
import { readServerRuntimeConfig } from "../src/services/serverConfig.js";

test("server config enables auth only when PI_GUI_AUTH_TOKEN is set", () => {
  assert.deepEqual(readServerRuntimeConfig({}), {
    host: "127.0.0.1",
    port: 8787,
    mode: "development",
    authToken: undefined,
    authRequired: false,
    remoteLan: false,
  });

  assert.deepEqual(readServerRuntimeConfig({ HOST: "127.0.0.1", PORT: "34567", PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: " secret " }), {
    host: "127.0.0.1",
    port: 34567,
    mode: "desktop",
    authToken: "secret",
    authRequired: true,
    remoteLan: false,
    authTokenSource: "env",
  });

  assert.equal(readServerRuntimeConfig({ PI_GUI_HOST: "localhost", HOST: "0.0.0.0", PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: "secret" }).host, "localhost");
  assert.equal(
    readServerRuntimeConfig({ PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: "secret", PI_GUI_DESKTOP_LAUNCH_ID: " launch-1 " }).desktopLaunchId,
    "launch-1",
  );
});

test("server config rejects desktop or production-managed mode without a token", () => {
  assert.throws(() => readServerRuntimeConfig({ PI_GUI_MODE: "desktop" }), /PI_GUI_AUTH_TOKEN is required/);
  assert.throws(() => readServerRuntimeConfig({ NODE_ENV: "production" }), /PI_GUI_AUTH_TOKEN is required/);
});

test("server config keeps desktop and production modes on loopback hosts", () => {
  assert.throws(
    () => readServerRuntimeConfig({ HOST: "0.0.0.0", PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: "secret" }),
    /loopback address/,
  );
  assert.throws(
    () => readServerRuntimeConfig({ HOST: "192.168.1.10", NODE_ENV: "production", PI_GUI_AUTH_TOKEN: "secret" }),
    /loopback address/,
  );
  assert.equal(readServerRuntimeConfig({ HOST: "[::1]", PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: "secret" }).host, "[::1]");
  assert.equal(readServerRuntimeConfig({ HOST: "0.0.0.0" }).host, "0.0.0.0");
});

test("server config supports explicit and persisted remote-lan mode with required auth", () => {
  assert.throws(() => readServerRuntimeConfig({ PI_GUI_MODE: "remote-lan" }), /remote-lan server mode/);

  assert.deepEqual(readServerRuntimeConfig({ PI_GUI_MODE: "remote-lan", PI_GUI_AUTH_TOKEN: "secret" }), {
    host: "0.0.0.0",
    port: 8787,
    mode: "remote-lan",
    authToken: "secret",
    authRequired: true,
    remoteLan: true,
    authTokenSource: "env",
  });

  assert.deepEqual(readServerRuntimeConfig({}, { enabled: true, authToken: "persisted-token" }), {
    host: "0.0.0.0",
    port: 8787,
    mode: "remote-lan",
    authToken: "persisted-token",
    authRequired: true,
    remoteLan: true,
    authTokenSource: "persisted",
  });

  assert.equal(readServerRuntimeConfig({ HOST: "127.0.0.1" }, { enabled: true, authToken: "persisted-token" }).host, "0.0.0.0");
  assert.equal(readServerRuntimeConfig({ PI_GUI_HOST: "192.168.1.10", HOST: "127.0.0.1" }, { enabled: true, authToken: "persisted-token" }).host, "192.168.1.10");

  assert.throws(() => readServerRuntimeConfig({ HOST: "0.0.0.0", PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: "secret" }, { enabled: false }), /loopback address/);
});

test("persisted remote-lan does not override managed loopback modes", () => {
  assert.deepEqual(
    readServerRuntimeConfig({ PORT: "49863", PI_GUI_MODE: "desktop", PI_GUI_AUTH_TOKEN: "secret", PI_GUI_DESKTOP_LAUNCH_ID: "launch-1" }, { enabled: true, authToken: "persisted-token" }),
    {
      host: "127.0.0.1",
      port: 49863,
      mode: "desktop",
      authToken: "secret",
      authRequired: true,
      remoteLan: false,
      authTokenSource: "env",
      desktopLaunchId: "launch-1",
    },
  );

  assert.equal(
    readServerRuntimeConfig({ NODE_ENV: "production", PI_GUI_AUTH_TOKEN: "secret" }, { enabled: true, authToken: "persisted-token" }).mode,
    "production",
  );
});
