import { BrowserWindow, dialog } from "electron";

export type CreateMainWindowOptions = {
  preloadPath: string;
  transparentWindow: boolean;
  onClosed: () => void;
  onCreated?: (window: BrowserWindow) => void;
};

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "Pi GUI",
    frame: false,
    roundedCorners: true,
    thickFrame: true,
    transparent: options.transparentWindow,
    hasShadow: true,
    autoHideMenuBar: true,
    backgroundColor: options.transparentWindow ? "#00000000" : "#1b1b1a",
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [options.transparentWindow ? "--pi-gui-transparent-window=1" : "--pi-gui-transparent-window=0"],
    },
  });

  options.onCreated?.(window);
  window.on("closed", options.onClosed);

  return window;
}

export async function loadStartupPage(window: BrowserWindow, state: { title: string; status: string; detail?: string }): Promise<void> {
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

export function showFatalError(title: string, message: string): void {
  dialog.showErrorBox(title, message);
  console.error(`${title}: ${message}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}
