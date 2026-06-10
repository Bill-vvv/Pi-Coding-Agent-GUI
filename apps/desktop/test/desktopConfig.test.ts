import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { win32 } from "node:path";
import test from "node:test";
import { backendEnv, createDesktopLaunchConfig, decodeRendererConfig, defaultBackendCommand, desktopBackendHostKind, desktopMode, desktopTransparentWindow, encodeRendererConfig, parsePort, parsePositiveInt, resolveBackendHost, resolveDesktopDataDir, windowsHasNativeRoundedCorners } from "../src/desktopConfig.js";
import { backendShellScript, waitForBackendHealth, windowsBackendLaunch, wslArgs } from "../src/backendSupervisor.js";
import type { DesktopLaunchConfig } from "../src/desktopConfig.js";

test("desktop mode defaults to dev unless packaged or explicitly built", () => {
  assert.equal(desktopMode({}, false), "dev");
  assert.equal(desktopMode({}, true), "built");
  assert.equal(desktopMode({ PI_GUI_DESKTOP_MODE: "production" }, false), "built");
  assert.equal(desktopMode({ PI_GUI_DESKTOP_MODE: "development" }, true), "dev");
});

test("desktop transparent window mode enables Win10-compatible rounded corners", () => {
  assert.equal(windowsHasNativeRoundedCorners("10.0.22631"), true);
  assert.equal(windowsHasNativeRoundedCorners("10.0.19045"), false);
  assert.equal(desktopTransparentWindow({}, "win32", "10.0.19045"), true);
  assert.equal(desktopTransparentWindow({}, "win32", "10.0.22631"), false);
  assert.equal(desktopTransparentWindow({}, "linux", ""), false);
  assert.equal(desktopTransparentWindow({ PI_GUI_DESKTOP_TRANSPARENT_WINDOW: "1" }, "win32", "10.0.22631"), true);
  assert.equal(desktopTransparentWindow({ PI_GUI_DESKTOP_TRANSPARENT_WINDOW: "false" }, "win32", "10.0.19045"), false);
  assert.throws(() => desktopTransparentWindow({ PI_GUI_DESKTOP_TRANSPARENT_WINDOW: "maybe" }, "win32", "10.0.19045"), /Unsupported PI_GUI_DESKTOP_TRANSPARENT_WINDOW/);
});

test("default backend commands build host prerequisites before starting server", () => {
  assert.equal(defaultBackendCommand("dev"), "npm run build -w @pi-gui/shared && exec npm run dev -w @pi-gui/server");
  assert.equal(defaultBackendCommand("built"), "npm run build -w @pi-gui/shared && npm run build -w @pi-gui/server && exec npm run start -w @pi-gui/server");
  assert.equal(defaultBackendCommand("dev", "windows"), "npm run build -w @pi-gui/shared && npm run dev -w @pi-gui/server");
  assert.equal(defaultBackendCommand("built", "windows"), "npm run build -w @pi-gui/shared && npm run build -w @pi-gui/server && npm run start -w @pi-gui/server");
});

test("desktop backend host selection supports WSL by default and explicit Windows native host", () => {
  assert.equal(desktopBackendHostKind({}), "wsl");
  assert.equal(desktopBackendHostKind({ PI_GUI_DESKTOP_HOST: "auto" }), "wsl");
  assert.equal(desktopBackendHostKind({ PI_GUI_DESKTOP_HOST: "windows" }), "windows");
  assert.equal(desktopBackendHostKind({ PI_GUI_DESKTOP_HOST: " ", PI_GUI_DESKTOP_BACKEND_HOST: "native" }), "windows");
  assert.equal(desktopBackendHostKind({ PI_GUI_DESKTOP_BACKEND_HOST: "native" }), "windows");
  assert.throws(() => desktopBackendHostKind({ PI_GUI_DESKTOP_HOST: "linux" }), /Unsupported PI_GUI_DESKTOP_HOST/);

  assert.deepEqual(resolveBackendHost("C:/repo/pi-gui", { PI_GUI_DESKTOP_HOST: "windows" }), { kind: "windows", cwd: "C:/repo/pi-gui" });
  assert.deepEqual(resolveBackendHost("C:/repo/pi-gui", { PI_GUI_DESKTOP_HOST: "windows", PI_GUI_DESKTOP_WINDOWS_CWD: "D:/pi-gui" }), { kind: "windows", cwd: "D:/pi-gui" });
  assert.deepEqual(resolveBackendHost("C:/repo/pi-gui", { PI_GUI_DESKTOP_HOST: "wsl", PI_GUI_DESKTOP_WSL_CWD: "/home/user/pi-gui", PI_GUI_DESKTOP_WSL_DISTRO: "Ubuntu" }), {
    kind: "wsl",
    distro: "Ubuntu",
    cwd: "/home/user/pi-gui",
  });
});

test("desktop data dir defaults to a stable server-package path for each host", () => {
  assert.equal(resolveDesktopDataDir({ kind: "windows", cwd: "C:/repo/pi-gui" }, {}), win32.join("C:/repo/pi-gui", "apps", "server", ".pi-gui"));
  assert.equal(resolveDesktopDataDir({ kind: "windows", cwd: "C:/repo/pi-gui" }, { PI_GUI_DESKTOP_DATA_DIR: ".pi-gui-dev" }), win32.join("C:/repo/pi-gui", "apps", "server", ".pi-gui-dev"));
  assert.equal(resolveDesktopDataDir({ kind: "wsl", cwd: "/home/user/pi-gui" }, {}), "/home/user/pi-gui/apps/server/.pi-gui");
  assert.equal(resolveDesktopDataDir({ kind: "wsl", cwd: "/home/user/pi-gui" }, { PI_GUI_DESKTOP_DATA_DIR: ".pi-gui-dev" }), "/home/user/pi-gui/apps/server/.pi-gui-dev");
});

test("desktop launch config uses nonblank env fallback for backend port", async () => {
  const config = await createDesktopLaunchConfig({
    isPackaged: false,
    repoRoot: "C:/repo/pi-gui",
    env: {
      PI_GUI_DESKTOP_HOST: "windows",
      PI_GUI_DESKTOP_BACKEND_PORT: " ",
      PORT: "8787",
      PI_GUI_DESKTOP_AUTH_TOKEN: "secret",
    },
  });

  assert.equal(config.backendPort, 8787);
  assert.equal(config.rendererConfig.apiBaseUrl, "http://127.0.0.1:8787");
  assert.equal(config.dataDir, win32.join("C:/repo/pi-gui", "apps", "server", ".pi-gui"));
});


test("desktop launch config ignores inherited backend env for generic port and data dir", async () => {
  const config = await createDesktopLaunchConfig({
    isPackaged: false,
    repoRoot: "C:/repo/pi-gui",
    env: {
      PI_GUI_MODE: "desktop",
      PI_GUI_AUTH_TOKEN: "inherited-token",
      PORT: "9999",
      PI_GUI_DATA_DIR: ".pi-gui-desktop",
      PI_GUI_DESKTOP_HOST: "windows",
      PI_GUI_DESKTOP_BACKEND_PORT: "4567",
    },
  });

  assert.equal(config.backendPort, 4567);
  assert.equal(config.dataDir, win32.join("C:/repo/pi-gui", "apps", "server", ".pi-gui"));
});

test("renderer config encoding round-trips API, WebSocket, and auth token", () => {
  const config = { apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret" };
  assert.deepEqual(decodeRendererConfig(encodeRendererConfig(config)), config);
  assert.equal(decodeRendererConfig("not-valid"), undefined);
});

test("backend env uses desktop mode, loopback host, controlled port, token, and optional data dir", () => {
  assert.deepEqual(backendEnv({ backendPort: 4567, authToken: "secret" }), {
    PI_GUI_MODE: "desktop",
    PI_GUI_HOST: "127.0.0.1",
    PORT: "4567",
    PI_GUI_AUTH_TOKEN: "secret",
  });
  assert.deepEqual(backendEnv({ backendPort: 4567, authToken: "secret", dataDir: ".pi-gui-dev" }), {
    PI_GUI_MODE: "desktop",
    PI_GUI_HOST: "127.0.0.1",
    PORT: "4567",
    PI_GUI_AUTH_TOKEN: "secret",
    PI_GUI_DATA_DIR: ".pi-gui-dev",
  });
  assert.deepEqual(backendEnv({ backendPort: 4567, authToken: "secret", backendHost: { kind: "wsl", distro: "Ubuntu", cwd: "/home/user/pi-gui" } }), {
    PI_GUI_MODE: "desktop",
    PI_GUI_HOST: "127.0.0.1",
    PORT: "4567",
    PI_GUI_AUTH_TOKEN: "secret",
    PI_GUI_EXECUTION_HOST_KIND: "wsl",
    PI_GUI_EXECUTION_HOST_ID: "wsl:Ubuntu",
    PI_GUI_EXECUTION_HOST_LABEL: "WSL (Ubuntu)",
    PI_GUI_DESKTOP_WSL_DISTRO: "Ubuntu",
  });
});

test("WSL launch args use optional distro, WSL cwd, and shell script without logging token separately", () => {
  const config: DesktopLaunchConfig = {
    mode: "dev",
    repoRoot: "C:/repo/pi-gui",
    webUrl: "http://127.0.0.1:5173",
    webIndexPath: "C:/repo/pi-gui/apps/web/dist/index.html",
    backendPort: 4567,
    dataDir: ".pi-gui-dev",
    authToken: "secret'quoted",
    desktopLaunchId: "launch-1",
    rendererConfig: { apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret'quoted" },
    backendHost: { kind: "wsl", distro: "Ubuntu", cwd: "/home/user/pi-gui" },
    backendCommand: "npm run dev -w @pi-gui/server",
    backendReadyTimeoutMs: 30000,
  };

  const args = wslArgs(config);
  assert.deepEqual(args, ["-d", "Ubuntu", "--cd", "/home/user/pi-gui", "--", "bash", "-se"]);
  assert.equal(args.some((arg) => arg.includes("secret")), false);
  const script = backendShellScript(config);
  assert.match(script, /export PI_GUI_MODE='desktop'/);
  assert.match(script, /export PI_GUI_HOST='127\.0\.0\.1'/);
  assert.match(script, /export PORT='4567'/);
  assert.match(script, /export PI_GUI_AUTH_TOKEN='secret'"'"'quoted'/);
  assert.match(script, /export PI_GUI_DESKTOP_LAUNCH_ID='launch-1'/);
  assert.match(script, /export PI_GUI_DATA_DIR='\.pi-gui-dev'/);
  assert.match(script, /npm run dev -w @pi-gui\/server/);
});

test("Windows backend launch uses Windows cwd, desktop env, and no WSL args", () => {
  const config: DesktopLaunchConfig = {
    mode: "dev",
    repoRoot: "C:/repo/pi-gui",
    webUrl: "http://127.0.0.1:5173",
    webIndexPath: "C:/repo/pi-gui/apps/web/dist/index.html",
    backendPort: 4567,
    authToken: "secret",
    desktopLaunchId: "launch-1",
    rendererConfig: { apiBaseUrl: "http://127.0.0.1:4567", wsUrl: "ws://127.0.0.1:4567/ws", authToken: "secret" },
    backendHost: { kind: "windows", cwd: "C:/repo/pi-gui" },
    backendCommand: defaultBackendCommand("dev", "windows"),
    backendReadyTimeoutMs: 30000,
  };

  const launch = windowsBackendLaunch(config);
  assert.match(launch.command, /cmd\.exe|cmd$/i);
  assert.deepEqual(launch.args, ["/d", "/s", "/c", "npm run build -w @pi-gui/shared && npm run dev -w @pi-gui/server"]);
  assert.equal(launch.cwd, "C:/repo/pi-gui");
  assert.equal(launch.env.PI_GUI_MODE, "desktop");
  assert.equal(launch.env.PI_GUI_HOST, "127.0.0.1");
  assert.equal(launch.env.PORT, "4567");
  assert.equal(launch.env.PI_GUI_AUTH_TOKEN, "secret");
  assert.equal(launch.env.PI_GUI_DESKTOP_LAUNCH_ID, "launch-1");
});

test("desktop backend readiness requires the token-protected launch id", async (t) => {
  let observedAuthorization: string | undefined;
  const server = createServer((request, response) => {
    if (request.url !== "/api/desktop/ready") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    observedAuthorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, mode: "desktop", launchId: "launch-1" }));
  });
  await listen(server);
  t.after(() => server.close());
  const address = server.address() as AddressInfo;

  await waitForBackendHealth({ backendPort: address.port, backendReadyTimeoutMs: 500, authToken: "secret", desktopLaunchId: "launch-1" });

  assert.equal(observedAuthorization, "Bearer secret");
});

test("desktop backend readiness rejects stale health-only listeners", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await listen(server);
  t.after(() => server.close());
  const address = server.address() as AddressInfo;

  await assert.rejects(
    waitForBackendHealth({ backendPort: address.port, backendReadyTimeoutMs: 50, authToken: "secret", desktopLaunchId: "launch-1" }),
    /different Pi GUI backend instance/,
  );
});

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

test("port and positive integer parsers reject invalid values", () => {
  assert.equal(parsePort("8787"), 8787);
  assert.equal(parsePort("0"), undefined);
  assert.equal(parsePort("70000"), undefined);
  assert.equal(parsePort("abc"), undefined);
  assert.equal(parsePositiveInt("30000"), 30000);
  assert.equal(parsePositiveInt("0"), undefined);
});
