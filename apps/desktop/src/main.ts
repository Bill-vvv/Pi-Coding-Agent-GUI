import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBackend, type BackendSupervisor } from "./backendSupervisor.js";
import { createDesktopLaunchConfig, desktopTransparentWindow, type DesktopBackendHost, type DesktopBackendHostKind, type RendererRuntimeConfig } from "./desktopConfig.js";
import { createDesktopLogStreams, type DesktopLogStreams } from "./logs.js";
import { desktopHostChannels, rendererConfigChannels, windowControlChannels, type WindowStatePayload } from "./windowControls.js";
import { registerDesktopPetIpc } from "./services/desktopPet/desktopPetIpc.js";
import { createDesktopPetWindowService, type DesktopPetWindowService } from "./services/desktopPet/desktopPetWindow.js";

let backend: BackendSupervisor | undefined;
let logs: DesktopLogStreams | undefined;
let startupWindow: BrowserWindow | undefined;
let desktopPetService: DesktopPetWindowService | undefined;
let pendingHostSelection: ((host: DesktopBackendHostKind) => void) | undefined;
let rendererRuntimeConfig: RendererRuntimeConfig | undefined;
let suppressNextWindowCloseQuit = false;
let isQuitting = false;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const preloadPath = resolve(dirname(fileURLToPath(import.meta.url)), "preload.js");

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", (event) => {
  if (!backend && !logs) return;
  event.preventDefault();
  void shutdown().finally(() => app.exit(0));
});

void app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  desktopPetService = createDesktopPetWindowService({
    preloadPath,
    repoRoot,
    preferencesPath: resolve(app.getPath("userData"), "desktop-pet.json"),
    isQuitting: () => isQuitting,
  });
  registerWindowControlIpc();
  registerDesktopHostIpc();
  registerRendererConfigIpc();
  registerDesktopPetIpc(ipcMain, desktopPetService);

  if (process.platform !== "win32") {
    showFatalError("Unsupported platform", "Pi GUI Desktop MVP currently supports Windows + WSL only. Run the existing web dev server on non-Windows platforms.");
    app.exit(1);
    return;
  }

  try {
    const selectedHost = await chooseBackendHostIfNeeded();
    if (selectedHost) process.env.PI_GUI_DESKTOP_HOST = selectedHost;

    const config = await createDesktopLaunchConfig({ isPackaged: app.isPackaged, repoRoot });
    logs = createDesktopLogStreams(app.getPath("logs"));
    rendererRuntimeConfig = config.rendererConfig;
    const window = createMainWindow();
    startupWindow = window;
    await loadStartupPage(window, {
      title: "Starting Pi GUI",
      status: `Launching ${hostLabel(config.backendHost)} backend…`,
      detail: logs.backendLogPath ? `Backend log: ${logs.backendLogPath}` : undefined,
    });

    backend = startBackend(config, logs.backendLog);
    await backend.ready;

    await loadStartupPage(window, {
      title: "Starting Pi GUI",
      status: "Backend is ready. Loading interface…",
      detail: `${hostLabel(config.backendHost)} backend: ${config.rendererConfig.apiBaseUrl}`,
    });

    startupWindow = undefined;

    if (config.mode === "dev" && config.webUrl) {
      await window.loadURL(config.webUrl);
    } else {
      if (!existsSync(config.webIndexPath)) {
        throw new Error(`Built web UI not found at ${config.webIndexPath}. Run npm run build -w @pi-gui/web first.`);
      }
      await window.loadFile(config.webIndexPath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const logHint = logs?.backendLogPath ? `\n\nBackend log: ${logs.backendLogPath}` : "";
    const hasErrorWindow = Boolean(startupWindow && !startupWindow.isDestroyed());
    if (hasErrorWindow && startupWindow) {
      await loadStartupPage(startupWindow, {
        title: "Pi GUI Desktop failed to start",
        status: message,
        detail: logs?.backendLogPath ? `Backend log: ${logs.backendLogPath}` : undefined,
      }).catch(() => undefined);
    } else {
      showFatalError("Pi GUI Desktop failed to start", `${message}${logHint}`);
    }
    await shutdown();
    if (hasErrorWindow) process.exitCode = 1;
    else app.exit(1);
  }
});

async function chooseBackendHostIfNeeded(): Promise<DesktopBackendHostKind | undefined> {
  const explicit = process.env.PI_GUI_DESKTOP_HOST?.trim().toLowerCase() || process.env.PI_GUI_DESKTOP_BACKEND_HOST?.trim().toLowerCase();
  if (explicit && explicit !== "auto" && explicit !== "choose") return undefined;

  const window = createMainWindow();
  startupWindow = window;
  await loadHostSelectionPage(window);

  return new Promise<DesktopBackendHostKind>((resolveHost) => {
    pendingHostSelection = (host) => {
      pendingHostSelection = undefined;
      suppressNextWindowCloseQuit = true;
      if (!window.isDestroyed()) window.close();
      startupWindow = undefined;
      resolveHost(host);
    };
  });
}

function createMainWindow(): BrowserWindow {
  const transparentWindow = desktopTransparentWindow(process.env, process.platform, release());
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Pi GUI",
    frame: false,
    roundedCorners: true,
    thickFrame: true,
    transparent: transparentWindow,
    hasShadow: true,
    autoHideMenuBar: true,
    backgroundColor: transparentWindow ? "#00000000" : "#1b1b1a",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [transparentWindow ? "--pi-gui-transparent-window=1" : "--pi-gui-transparent-window=0"],
    },
  });

  wireWindowStateEvents(window);
  wireRendererDiagnostics(window);

  window.on("closed", () => {
    if (suppressNextWindowCloseQuit) {
      suppressNextWindowCloseQuit = false;
      return;
    }
    if (!isQuitting) app.quit();
  });

  return window;
}

async function loadHostSelectionPage(window: BrowserWindow): Promise<void> {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Choose Pi GUI host</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; color: #f4efe4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { overflow: hidden; }
  .desktop-page-shell { width: 100%; height: 100%; display: grid; place-items: center; overflow: hidden; border-radius: 18px; background: #1b1b1a; }
  main { width: min(760px, calc(100vw - 56px)); border: 1px solid rgba(244, 239, 228, 0.12); border-radius: 22px; background: rgba(255, 255, 255, 0.035); padding: 30px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35); }
  h1 { margin: 0 0 10px; font-size: 24px; font-weight: 680; }
  .intro { margin: 0 0 22px; line-height: 1.55; color: rgba(244, 239, 228, 0.76); }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  button { text-align: left; border: 1px solid rgba(244, 239, 228, 0.14); border-radius: 18px; background: rgba(255,255,255,0.045); color: inherit; padding: 18px; cursor: pointer; min-height: 170px; }
  button:hover { border-color: rgba(240, 171, 86, 0.58); background: rgba(240, 171, 86, 0.09); }
  .name { display: block; font-size: 18px; font-weight: 650; margin-bottom: 8px; }
  .desc { display: block; color: rgba(244, 239, 228, 0.72); line-height: 1.5; }
  .hint { display: block; margin-top: 14px; color: rgba(244, 239, 228, 0.52); font-size: 12px; line-height: 1.4; }
</style>
</head>
<body>
<div class="desktop-page-shell">
<main>
  <h1>Choose where Pi should run</h1>
  <p class="intro">Pi GUI can supervise a backend in WSL or directly on Windows. The selected backend host owns its own projects, Pi config, sessions, and provider state.</p>
  <div class="grid">
    <button id="wsl" type="button">
      <span class="name">WSL host</span>
      <span class="desc">Use the existing WSL backend and WSL-side <code>pi --mode rpc</code>. Recommended when your projects and Pi config already live in Linux.</span>
      <span class="hint">Uses WSL paths and WSL <code>~/.pi</code>.</span>
    </button>
    <button id="windows" type="button">
      <span class="name">Windows native host</span>
      <span class="desc">Run the backend and <code>pi --mode rpc</code> directly on Windows. Choose this if your Pi setup and projects are Windows-native.</span>
      <span class="hint">Requires Windows backend dependencies and Windows-side Pi config.</span>
    </button>
  </div>
</main>
</div>
<script>
  document.getElementById('wsl').addEventListener('click', () => window.__PI_GUI_DESKTOP__?.selectBackendHost('wsl'));
  document.getElementById('windows').addEventListener('click', () => window.__PI_GUI_DESKTOP__?.selectBackendHost('windows'));
</script>
</body>
</html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function loadStartupPage(window: BrowserWindow, state: { title: string; status: string; detail?: string }): Promise<void> {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(state.title)}</title>
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; color: #f4efe4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { overflow: hidden; }
  .desktop-page-shell { width: 100%; height: 100%; display: grid; place-items: center; overflow: hidden; border-radius: 18px; background: #1b1b1a; }
  main { width: min(560px, calc(100vw - 56px)); border: 1px solid rgba(244, 239, 228, 0.12); border-radius: 20px; background: rgba(255, 255, 255, 0.035); padding: 28px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35); }
  h1 { margin: 0 0 14px; font-size: 22px; font-weight: 650; }
  p { margin: 0; line-height: 1.55; color: rgba(244, 239, 228, 0.76); }
  .detail { margin-top: 16px; padding: 14px 16px; border-radius: 14px; background: rgba(0, 0, 0, 0.22); color: rgba(244, 239, 228, 0.68); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<div class="desktop-page-shell">
<main>
  <h1>${escapeHtml(state.title)}</h1>
  <p>${escapeHtml(state.status)}</p>
  ${state.detail ? `<div class="detail">${escapeHtml(state.detail)}</div>` : ""}
</main>
</div>
</body>
</html>`;
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function hostLabel(host: DesktopBackendHost): string {
  return host.kind === "wsl" ? `WSL${host.distro ? ` (${host.distro})` : ""}` : "Windows native";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

async function shutdown(): Promise<void> {
  const currentBackend = backend;
  const currentLogs = logs;
  backend = undefined;
  logs = undefined;
  startupWindow = undefined;
  rendererRuntimeConfig = undefined;
  desktopPetService?.close();
  await currentBackend?.stop().catch(() => undefined);
  await currentLogs?.close().catch(() => undefined);
}

function showFatalError(title: string, message: string): void {
  dialog.showErrorBox(title, message);
  console.error(`${title}: ${message}`);
}

function registerRendererConfigIpc(): void {
  ipcMain.on(rendererConfigChannels.get, (event) => {
    event.returnValue = rendererRuntimeConfig;
  });
}

function registerDesktopHostIpc(): void {
  ipcMain.handle(desktopHostChannels.select, (_event, host: unknown) => {
    if (host !== "wsl" && host !== "windows") return false;
    pendingHostSelection?.(host);
    return true;
  });
}

function registerWindowControlIpc(): void {
  ipcMain.handle(windowControlChannels.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle(windowControlChannels.toggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.handle(windowControlChannels.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle(windowControlChannels.isMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}

function wireWindowStateEvents(window: BrowserWindow): void {
  const sendWindowState = () => {
    const payload: WindowStatePayload = { maximized: window.isMaximized() };
    window.webContents.send(windowControlChannels.stateChanged, payload);
  };

  window.on("maximize", sendWindowState);
  window.on("unmaximize", sendWindowState);
  window.on("restore", sendWindowState);
}

function wireRendererDiagnostics(window: BrowserWindow): void {
  const writeLog = (message: string) => logs?.backendLog.write(`[renderer] ${new Date().toISOString()} ${message}\n`);

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2 && !/\b(error|exception|uncaught|failed)\b/i.test(message)) return;
    writeLog(`console level=${level} source=${redactLogUrl(sourceId)}:${line} ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    writeLog(`render-process-gone ${JSON.stringify(details)}`);
  });
  window.webContents.on("unresponsive", () => {
    writeLog("window became unresponsive");
  });
  window.webContents.on("responsive", () => {
    writeLog("window became responsive");
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeLog(`did-fail-load mainFrame=${isMainFrame} code=${errorCode} description=${errorDescription} url=${redactLogUrl(validatedURL)}`);
  });
}

function redactLogUrl(value: string): string {
  return value.replace(/([?&](?:token|authToken|access_token)=)[^&]*/gi, "$1[redacted]");
}
