import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from "electron";
import { existsSync } from "node:fs";
import { release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startBackend, type BackendSupervisor } from "./backendSupervisor.js";
import { createDesktopLaunchConfig, desktopTransparentWindow, type DesktopBackendHost, type DesktopBackendHostKind, type RendererRuntimeConfig } from "./desktopConfig.js";
import { createDesktopLogStreams, type DesktopLogStreams } from "./logs.js";
import { desktopHostChannels, desktopPetChannels, rendererConfigChannels, windowControlChannels, type DesktopPetDisplayPayload, type WindowStatePayload } from "./windowControls.js";

let backend: BackendSupervisor | undefined;
let logs: DesktopLogStreams | undefined;
let startupWindow: BrowserWindow | undefined;
let desktopPetWindow: BrowserWindow | undefined;
let desktopPetDisplay: DesktopPetDisplayPayload | undefined;
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
  registerWindowControlIpc();
  registerDesktopHostIpc();
  registerRendererConfigIpc();
  registerDesktopPetIpc();

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
  closeDesktopPetWindow();
  await currentBackend?.stop().catch(() => undefined);
  await currentLogs?.close().catch(() => undefined);
}

function showFatalError(title: string, message: string): void {
  dialog.showErrorBox(title, message);
  console.error(`${title}: ${message}`);
}

function registerDesktopPetIpc(): void {
  ipcMain.handle(desktopPetChannels.setVisible, (_event, visible: unknown) => {
    if (visible) {
      createDesktopPetWindow();
      return true;
    }
    closeDesktopPetWindow();
    return true;
  });

  ipcMain.handle(desktopPetChannels.update, (_event, payload: unknown) => {
    const display = normalizeDesktopPetDisplay(payload);
    if (!display) return false;
    desktopPetDisplay = display;
    desktopPetWindow?.webContents.send(desktopPetChannels.updated, display);
    return true;
  });
}

function createDesktopPetWindow(): BrowserWindow {
  if (desktopPetWindow && !desktopPetWindow.isDestroyed()) {
    desktopPetWindow.show();
    if (desktopPetDisplay) desktopPetWindow.webContents.send(desktopPetChannels.updated, desktopPetDisplay);
    return desktopPetWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.workArea;
  const windowWidth = 286;
  const windowHeight = 118;
  const window = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.max(x, x + width - windowWidth - 28),
    y: Math.max(y, y + height - windowHeight - 36),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ["--pi-gui-transparent-window=1"],
    },
  });

  desktopPetWindow = window;
  window.setAlwaysOnTop(true, "floating");
  window.on("closed", () => {
    if (desktopPetWindow === window) desktopPetWindow = undefined;
    broadcastDesktopPetClosed();
  });

  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(desktopPetHtml())}`).then(() => {
    if (desktopPetDisplay && !window.isDestroyed()) window.webContents.send(desktopPetChannels.updated, desktopPetDisplay);
  });

  return window;
}

function closeDesktopPetWindow(): void {
  const window = desktopPetWindow;
  desktopPetWindow = undefined;
  if (window && !window.isDestroyed()) window.close();
}

function broadcastDesktopPetClosed(): void {
  if (isQuitting) return;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(desktopPetChannels.closed);
  }
}

function normalizeDesktopPetDisplay(payload: unknown): DesktopPetDisplayPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Partial<DesktopPetDisplayPayload>;
  if (typeof record.mood !== "string" || typeof record.tone !== "string" || typeof record.title !== "string" || typeof record.detail !== "string") return undefined;
  return {
    mood: compactDesktopPetText(record.mood, 32),
    tone: compactDesktopPetText(record.tone, 32),
    title: compactDesktopPetText(record.title, 80),
    detail: compactDesktopPetText(record.detail, 220),
    badges: Array.isArray(record.badges) ? record.badges.filter((item): item is string => typeof item === "string").map((item) => compactDesktopPetText(item, 48)).slice(0, 3) : [],
    satelliteCount: typeof record.satelliteCount === "number" && Number.isFinite(record.satelliteCount) ? Math.max(0, Math.min(3, Math.round(record.satelliteCount))) : 0,
  };
}

function compactDesktopPetText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, Math.max(0, maxLength - 1))}…` : compact;
}

function desktopPetHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Pi PET</title>
<style>
  html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; color: #f4efe4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { -webkit-app-region: drag; display: grid; place-items: center; user-select: none; }
  .pet { width: 268px; min-height: 96px; display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid rgba(244, 239, 228, 0.14); border-radius: 26px; background: rgba(28, 27, 25, 0.72); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.34); backdrop-filter: blur(18px); padding: 10px 10px 10px 12px; }
  .orb { position: relative; width: 52px; height: 52px; border-radius: 999px; color: #f0ab56; }
  .pet.tone-active .orb, .pet.tone-success .orb { color: #76c893; }
  .pet.tone-attention .orb { color: #f0ab56; }
  .pet.tone-danger .orb { color: #e57373; }
  .aura, .core, .tail, .satellite, .spark { position: absolute; border-radius: 999px; background: currentColor; }
  .aura { inset: 0; opacity: 0.12; transform: scale(0.9); border: 1px solid currentColor; background: transparent; }
  .core { inset: 8px; border-radius: 48% 52% 50% 50%; opacity: 0.94; animation: breathe 2600ms ease-in-out infinite; }
  .core::after { content: ""; position: absolute; inset: 7px; border-radius: inherit; background: #1c1b19; opacity: 0.36; }
  .face { position: absolute; z-index: 2; left: 17px; top: 17px; width: 18px; height: 14px; }
  .eye, .mouth { position: absolute; display: block; background: #171614; opacity: 0.82; }
  .eye { top: 2px; width: 4px; height: 4px; border-radius: 999px; }
  .eye.left { left: 2px; } .eye.right { right: 2px; }
  .mouth { left: 50%; bottom: 1px; width: 8px; height: 3px; border-radius: 0 0 999px 999px; transform: translateX(-50%); }
  .pet.mood-idle .eye, .pet.mood-sleeping .eye, .pet.mood-context .eye { height: 2px; transform: translateY(1px); }
  .pet.mood-waiting .mouth { width: 5px; height: 5px; border-radius: 999px; }
  .pet.mood-error .eye { height: 2px; } .pet.mood-error .eye.left { transform: rotate(36deg); } .pet.mood-error .eye.right { transform: rotate(-36deg); }
  .pet.mood-recovering .eye { height: 2px; } .pet.mood-recovering .eye.left { transform: rotate(-18deg); } .pet.mood-recovering .eye.right { transform: rotate(18deg); }
  .tail { right: 6px; bottom: 8px; width: 12px; height: 12px; border-radius: 70% 30% 70% 30%; opacity: 0.28; transform: rotate(22deg); }
  .satellite { width: 5px; height: 5px; opacity: 0.7; transform-origin: 26px 26px; animation: orbit 2600ms linear infinite; }
  .satellite-1 { top: 2px; left: 24px; } .satellite-2 { top: 36px; left: 4px; animation-delay: -860ms; } .satellite-3 { top: 38px; right: 5px; animation-delay: -1720ms; }
  .copy { min-width: 0; display: grid; gap: 4px; }
  strong { overflow: hidden; font-size: 13px; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
  p { margin: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; color: rgba(244, 239, 228, 0.72); font-size: 11px; line-height: 1.35; }
  .badges { display: flex; gap: 4px; overflow: hidden; }
  .badges span { flex: none; max-width: 88px; overflow: hidden; border: 1px solid rgba(244,239,228,0.13); border-radius: 999px; color: rgba(244,239,228,0.64); font-size: 9px; line-height: 1.2; padding: 2px 6px; text-overflow: ellipsis; white-space: nowrap; }
  button { -webkit-app-region: no-drag; align-self: start; width: 24px; height: 24px; border: 1px solid rgba(244,239,228,0.14); border-radius: 999px; background: rgba(255,255,255,0.04); color: rgba(244,239,228,0.72); cursor: pointer; }
  button:hover { border-color: rgba(240,171,86,0.58); color: #f4efe4; }
  @keyframes breathe { 0%, 100% { transform: scale(0.94) rotate(0deg); opacity: 0.8; } 50% { transform: scale(1.08) rotate(5deg); opacity: 1; } }
  @keyframes orbit { 0% { transform: rotate(0deg) translateY(-2px) rotate(0deg); } 100% { transform: rotate(360deg) translateY(-2px) rotate(-360deg); } }
  @media (prefers-reduced-motion: reduce) { .core, .satellite { animation: none !important; } }
</style>
</head>
<body>
  <main id="pet" class="pet mood-idle tone-neutral" aria-label="Pi PET desktop companion">
    <span class="orb" aria-hidden="true"><span class="aura"></span><span class="core"></span><span class="face"><span class="eye left"></span><span class="eye right"></span><span class="mouth"></span></span><span class="tail"></span><span class="satellite satellite-1"></span><span class="satellite satellite-2"></span><span class="satellite satellite-3"></span></span>
    <span class="copy"><strong id="title">Pi PET</strong><p id="detail">等待 Pi GUI 状态…</p><span id="badges" class="badges"></span></span>
    <button type="button" id="close" title="关闭桌宠" aria-label="关闭桌宠">×</button>
  </main>
<script>
  const pet = document.getElementById('pet');
  const title = document.getElementById('title');
  const detail = document.getElementById('detail');
  const badges = document.getElementById('badges');
  const satellites = Array.from(document.querySelectorAll('.satellite'));
  function applyDisplay(display) {
    pet.className = 'pet mood-' + display.mood + ' tone-' + display.tone;
    title.textContent = display.title || 'Pi PET';
    detail.textContent = display.detail || '';
    badges.replaceChildren(...(display.badges || []).slice(0, 2).map((badge) => {
      const item = document.createElement('span');
      item.textContent = badge;
      return item;
    }));
    satellites.forEach((item, index) => { item.style.display = index < (display.satelliteCount || 0) ? 'block' : 'none'; });
  }
  window.__PI_GUI_DESKTOP__?.onDesktopPetDisplay(applyDisplay);
  document.getElementById('close').addEventListener('click', () => window.__PI_GUI_DESKTOP__?.setDesktopPetVisible(false));
</script>
</body>
</html>`;
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
