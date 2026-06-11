import type { BrowserWindow, IpcMain } from "electron";
import type { DesktopBackendHost, DesktopBackendHostKind } from "./desktopConfig.js";
import { desktopHostChannels } from "./windowControls.js";

export function hostLabel(host: DesktopBackendHost): string {
  return host.kind === "wsl" ? `WSL${host.distro ? ` (${host.distro})` : ""}` : "Windows native";
}

export async function loadHostSelectionPage(window: BrowserWindow): Promise<void> {
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

export function registerDesktopHostIpc(ipcMain: IpcMain, selectHost: (host: DesktopBackendHostKind) => void): void {
  ipcMain.handle(desktopHostChannels.select, (_event, host: unknown) => {
    if (host !== "wsl" && host !== "windows") return false;
    selectHost(host);
    return true;
  });
}
