import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBackend, type BackendSupervisor } from "./backendSupervisor.js";
import { createDesktopLaunchConfig, desktopTransparentWindow, type DesktopBackendHostKind, type RendererRuntimeConfig } from "./desktopConfig.js";
import { hostLabel, loadHostSelectionPage, registerDesktopHostIpc } from "./hostSelection.js";
import { createDesktopLogStreams, type DesktopLogStreams } from "./logs.js";
import { wireRendererDiagnostics } from "./rendererDiagnostics.js";
import { registerDesktopPetIpc } from "./services/desktopPet/desktopPetIpc.js";
import { createDesktopPetWindowService, type DesktopPetWindowService } from "./services/desktopPet/desktopPetWindow.js";
import { createMainWindow as createDesktopMainWindow, loadStartupPage, showFatalError } from "./startupWindow.js";
import { rendererConfigChannels, windowControlChannels, type WindowStatePayload } from "./windowControls.js";

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
  registerDesktopHostIpc(ipcMain, (host) => pendingHostSelection?.(host));
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
  return createDesktopMainWindow({
    preloadPath,
    transparentWindow: desktopTransparentWindow(process.env, process.platform, release()),
    onCreated: (window) => {
      wireWindowStateEvents(window);
      wireRendererDiagnostics(window, writeRendererDiagnosticLog);
    },
    onClosed: () => {
      if (suppressNextWindowCloseQuit) {
        suppressNextWindowCloseQuit = false;
        return;
      }
      if (!isQuitting) app.quit();
    },
  });
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


function registerRendererConfigIpc(): void {
  ipcMain.on(rendererConfigChannels.get, (event) => {
    event.returnValue = rendererRuntimeConfig;
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

function writeRendererDiagnosticLog(message: string): void {
  logs?.backendLog.write(`[renderer] ${new Date().toISOString()} ${message}\n`);
}
