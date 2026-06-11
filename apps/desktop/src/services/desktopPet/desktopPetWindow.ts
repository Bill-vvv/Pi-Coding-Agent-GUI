import { BrowserWindow, screen } from "electron";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DesktopPetDisplayPayload, DesktopPetListPayload, DesktopPetPreferences, CodexPetBundle } from "./types.js";
import { discoverCodexPetBundles } from "./codexPetBundles.js";
import { loadDesktopPetPreferences, normalizeDesktopPetScale, saveDesktopPetPreferences } from "./desktopPetPreferences.js";
import { desktopPetHtml } from "./desktopPetHtml.js";
import { normalizeDesktopPetDisplay } from "./desktopPetState.js";
import { desktopPetChannels } from "../../windowControls.js";

export type DesktopPetWindowService = ReturnType<typeof createDesktopPetWindowService>;

export function createDesktopPetWindowService({ preloadPath, repoRoot, preferencesPath, isQuitting }: { preloadPath: string; repoRoot: string; preferencesPath: string; isQuitting: () => boolean }) {
  let window: BrowserWindow | undefined;
  let display = normalizeDesktopPetDisplay({ title: "Pi PET", detail: "等待 Pi GUI 状态…", badges: [], mood: "idle", tone: "neutral" });
  let preferences = loadDesktopPetPreferences(preferencesPath);
  let bundles = discoverCodexPetBundles({ repoRoot });

  function refreshBundles(): CodexPetBundle[] {
    bundles = discoverCodexPetBundles({ repoRoot });
    return bundles;
  }

  function selectedBundle(): CodexPetBundle {
    if (bundles.length === 0) refreshBundles();
    return bundles.find((bundle) => bundle.id === preferences.selectedPetId) ?? bundles[0] ?? fallbackBundle(repoRoot);
  }

  function persist(next: DesktopPetPreferences): void {
    preferences = next;
    saveDesktopPetPreferences(preferencesPath, preferences);
  }

  function snapshot() {
    return { display, bundle: selectedBundle(), preferences };
  }

  function setVisible(visible: boolean): boolean {
    if (visible) {
      createOrShowWindow();
      return true;
    }
    close();
    return true;
  }

  function updateDisplay(payload: unknown): boolean {
    const normalized = normalizeDesktopPetDisplay(payload);
    if (!normalized) return false;
    display = normalized;
    window?.webContents.send(desktopPetChannels.updated, snapshot());
    return true;
  }

  function listPets(): DesktopPetListPayload {
    refreshBundles();
    const bundle = selectedBundle();
    const visibleBundles = bundles.length > 0 ? bundles : [bundle];
    return {
      pets: visibleBundles.map(({ id, displayName, description, source, legacy, warning }) => ({ id, displayName, description, source, legacy, warning })),
      selectedPetId: bundle.id,
      scale: preferences.scale,
    };
  }

  function selectPet(petId: string): boolean {
    refreshBundles();
    if (!bundles.some((bundle) => bundle.id === petId)) return false;
    persist({ ...preferences, selectedPetId: petId });
    window?.webContents.send(desktopPetChannels.updated, snapshot());
    return true;
  }

  function setScale(scale: unknown): boolean {
    persist({ ...preferences, scale: normalizeDesktopPetScale(scale) });
    if (window && !window.isDestroyed()) {
      const bounds = windowBounds(preferences.scale);
      window.setSize(bounds.width, bounds.height);
      window.webContents.send(desktopPetChannels.updated, snapshot());
    }
    return true;
  }

  function resetPosition(): boolean {
    const bounds = windowBounds(preferences.scale);
    const position = defaultPosition(bounds.width, bounds.height);
    persist({ ...preferences, position, pin: "bottom-right" });
    if (window && !window.isDestroyed()) window.setPosition(position.x, position.y);
    return true;
  }

  function createOrShowWindow(): BrowserWindow {
    if (window && !window.isDestroyed()) {
      window.show();
      window.webContents.send(desktopPetChannels.updated, snapshot());
      return window;
    }

    const size = windowBounds(preferences.scale);
    const position = clampPosition(preferences.position ?? defaultPosition(size.width, size.height), size.width, size.height);
    const petWindow = new BrowserWindow({
      width: size.width,
      height: size.height,
      x: position.x,
      y: position.y,
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
    window = petWindow;
    petWindow.setAlwaysOnTop(true, "floating");
    petWindow.on("move", () => {
      if (petWindow.isDestroyed()) return;
      const [x, y] = petWindow.getPosition();
      persist({ ...preferences, position: { x, y }, pin: "free" });
    });
    petWindow.on("closed", () => {
      if (window === petWindow) window = undefined;
      if (!isQuitting()) broadcastClosed();
    });
    void petWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(desktopPetHtml())}`).then(() => {
      if (!petWindow.isDestroyed()) petWindow.webContents.send(desktopPetChannels.updated, snapshot());
    });
    return petWindow;
  }

  function close(): void {
    const petWindow = window;
    window = undefined;
    if (petWindow && !petWindow.isDestroyed()) petWindow.close();
  }

  function broadcastClosed(): void {
    for (const candidate of BrowserWindow.getAllWindows()) {
      if (!candidate.isDestroyed()) candidate.webContents.send(desktopPetChannels.closed);
    }
  }

  return { setVisible, updateDisplay, listPets, selectPet, setScale, resetPosition, close };
}

export function windowBounds(scale: number): { width: number; height: number } {
  return { width: Math.round(430 * scale), height: Math.round(190 * scale) };
}

export function defaultPosition(width: number, height: number): { x: number; y: number } {
  const { x, y, width: displayWidth, height: displayHeight } = screen.getPrimaryDisplay().workArea;
  return { x: x + displayWidth - width - 28, y: y + displayHeight - height - 36 };
}

export function clampPosition(position: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
  const displays = screen.getAllDisplays();
  const workArea = displays.find((display) => {
    const area = display.workArea;
    return position.x >= area.x && position.x <= area.x + area.width && position.y >= area.y && position.y <= area.y + area.height;
  })?.workArea ?? screen.getPrimaryDisplay().workArea;
  return {
    x: Math.max(workArea.x, Math.min(position.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(position.y, workArea.y + workArea.height - height)),
  };
}

function fallbackBundle(repoRoot: string): CodexPetBundle {
  const directory = resolve(repoRoot, "apps", "desktop", "assets", "pets", "pi-default");
  const spritesheetPath = resolve(directory, "spritesheet.webp");
  return {
    id: "pi-default",
    displayName: "Pi Default",
    description: "Bundled Pi GUI fallback pet.",
    directory,
    spritesheetPath,
    spritesheetUrl: pathToFileURL(spritesheetPath).toString(),
    source: "bundled",
  };
}
